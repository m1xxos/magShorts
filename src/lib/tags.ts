import { getDb } from "./db";
import { EMBEDDING_DIM, bufferToVector, embedTexts } from "./embeddings";

// Zero-shot topic tagging on the shared e5 embeddings: each tag is an
// e5 "query: …" description; an article gets the tags whose queries land
// close enough to its (already computed) passage vector. Strong lexical
// signals (kubernetes, ansible…) are force-matched by regex.

interface TagDef {
  slug: string;
  query: string;
  pattern?: RegExp;
}

export const TAG_DEFS: TagDef[] = [
  // — tech —
  { slug: "k8s", query: "Kubernetes, container orchestration, clusters, pods, helm charts", pattern: /kubernetes|k8s|kubectl|helm chart|kustomize/i },
  { slug: "docker", query: "Docker containers, container images, dockerfiles, container runtimes", pattern: /docker|containerd|podman|dockerfile/i },
  { slug: "ci/cd", query: "continuous integration and deployment pipelines, build automation, release engineering", pattern: /ci\/cd|gitlab ci|github actions|jenkins|argo ?cd|gitops/i },
  { slug: "iac", query: "infrastructure as code, terraform, cloud provisioning and configuration management", pattern: /terraform|opentofu|pulumi|infrastructure as code|crossplane/i },
  { slug: "ansible", query: "Ansible playbooks, server configuration automation", pattern: /ansible/i },
  { slug: "devops", query: "devops practices, site reliability engineering, platform engineering, on-call operations", pattern: /devops|\bsre\b|platform engineering/i },
  { slug: "monitoring", query: "observability, metrics, tracing, alerting, prometheus and grafana dashboards", pattern: /prometheus|grafana|opentelemetry|observability|викториямет|victoriametrics/i },
  { slug: "logging", query: "log collection and analysis, log pipelines, elasticsearch and loki", pattern: /\blogs?\b.*(pipeline|collect|shipp)|\bloki\b|elasticsearch|логировани/i },
  { slug: "security", query: "information security, vulnerabilities, exploits, hacking, malware, penetration testing", pattern: /vulnerabilit|exploit|malware|уязвимост|CVE-\d|penetration|ransomware|хакер/i },
  { slug: "auth", query: "authentication and authorization, single sign-on, OAuth, identity management", pattern: /oauth|keycloak|single sign|\bsso\b|аутентифика|authenticat/i },
  { slug: "networking", query: "computer networks, DNS, routing, protocols, VPN, load balancing", pattern: /\bdns\b|\bvpn\b|wireguard|\bbgp\b|load balanc|\btcp\b|маршрутизаци/i },
  { slug: "linux", query: "Linux systems administration, kernel, shell, systemd, distributions", pattern: /linux|systemd|\bbash\b|debian|ubuntu|fedora|\barch linux\b/i },
  { slug: "paas", query: "platform as a service, managed hosting platforms, serverless deployment platforms" },
  { slug: "cloud", query: "cloud computing providers and services, AWS, Azure, GCP, cloud infrastructure", pattern: /\baws\b|azure|google cloud|\bgcp\b|s3\b|облачн/i },
  { slug: "databases", query: "databases, SQL, storage engines, replication, PostgreSQL, SQLite, ClickHouse", pattern: /postgres|sqlite|clickhouse|mysql|базы? данных|database|redis|mongo/i },
  { slug: "ai", query: "artificial intelligence, machine learning, large language models, neural networks", pattern: /\ba\.?i\.?\b|\bllm\b|\bgpt\b|neural|chatgpt|claude|openai|нейросет|машинн\w+ обучени|искусственн\w+ интеллект/i },
  { slug: "programming", query: "software development, programming languages, code, engineering practices", pattern: /\bgolang\b|\brust\b|python|typescript|javascript|программировани/i },
  { slug: "comp-sci", query: "computer science theory, algorithms, data structures, distributed systems design", pattern: /algorithm|distributed systems|data structure|алгоритм/i },
  { slug: "web", query: "web development, browsers, frontend frameworks, CSS, web standards", pattern: /browser|frontend|\bcss\b|react|next\.js|браузер/i },
  { slug: "hardware", query: "computer hardware, chips, electronics, gadgets, processors, devices", pattern: /процессор|видеокарт|печатн\w+ плат|микроконтроллер|raspberry pi|arduino/i },
  { slug: "performance", query: "software performance optimization, benchmarks, profiling, latency tuning", pattern: /benchmark|profiling|оптимизаци\w+ производительн/i },
  { slug: "opensource", query: "open source projects, licenses, maintainers and community", pattern: /open.?source|открыт\w+ исходн/i },
  // — general —
  { slug: "politics", query: "politics, elections, government policy, geopolitics, world affairs" },
  { slug: "business", query: "business, companies, startups, markets, corporate strategy" },
  { slug: "economy", query: "economy, inflation, trade, labor market, macroeconomics" },
  { slug: "science", query: "scientific research and discoveries, physics, biology, chemistry" },
  { slug: "space", query: "space exploration, astronomy, rockets, NASA, planets", pattern: /\bnasa\b|spacex|космос|телескоп|asteroid|астероид/i },
  { slug: "climate", query: "climate change, environment, energy transition, natural disasters" },
  { slug: "health", query: "health, medicine, disease, fitness, nutrition, mental wellbeing" },
  { slug: "psychology", query: "psychology, human behavior, relationships, emotions, self-improvement" },
  { slug: "culture", query: "culture, arts, ideas, essays on modern life" },
  { slug: "music", query: "music, musicians, albums, songs, concerts and the music industry" },
  { slug: "film-tv", query: "movies, television shows, streaming, directors and actors" },
  { slug: "books", query: "books, literature, authors, reading and publishing" },
  { slug: "media", query: "journalism, news media, social networks, internet platforms" },
  { slug: "history", query: "history, historical events and figures, archives" },
  { slug: "society", query: "society, social issues, inequality, cities, everyday life" },
  { slug: "education", query: "education, schools, universities, learning and teaching" },
  { slug: "food", query: "food, cooking, restaurants, recipes and drinks" },
  { slug: "travel", query: "travel, places, tourism, geography" },
  { slug: "sports", query: "sports, athletes, games, competitions" },
  { slug: "gaming", query: "video games, gaming industry, consoles and esports", pattern: /видеоигр|playstation|xbox|nintendo|steam\b/i },
  { slug: "design", query: "design, typography, user interfaces, architecture, aesthetics" },
  { slug: "crime", query: "crime, investigations, courts, law enforcement, justice" },
];

// e5 cosines cluster tightly (~0.77–0.88): the best tag is reliable, but
// runners-up a few thousandths behind are usually noise. So: take the top
// tag when it clears the floor, and extras only in a near-tie.
const ABS_FLOOR = 0.79;
const NEAR_TOP_GAP = 0.004;
const MAX_TAGS = 3;

let tagVectorsPromise: Promise<Float32Array[]> | null = null;

function getTagVectors(): Promise<Float32Array[]> {
  if (!tagVectorsPromise) {
    tagVectorsPromise = embedTexts(
      TAG_DEFS.map((tag) => `query: articles about ${tag.query}`)
    );
    tagVectorsPromise.catch(() => {
      tagVectorsPromise = null;
    });
  }
  return tagVectorsPromise;
}

// Cosine of the article vector against every tag query, best first.
export async function scoreTags(
  embedding: Float32Array
): Promise<Array<{ slug: string; score: number }>> {
  const vectors = await getTagVectors();
  const scored = TAG_DEFS.map((def, t) => {
    let cosine = 0;
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      cosine += vectors[t][i] * embedding[i];
    }
    return { slug: def.slug, score: cosine };
  });
  return scored.sort((a, b) => b.score - a.score);
}

export async function assignTags(
  embedding: Float32Array,
  text: string
): Promise<string[]> {
  const forced = TAG_DEFS.filter((def) => def.pattern?.test(text)).map(
    (def) => def.slug
  );
  const scored = await scoreTags(embedding);
  const top = scored[0]?.score ?? 0;
  const semantic = scored
    .filter(
      (entry) =>
        !forced.includes(entry.slug) &&
        entry.score >= ABS_FLOOR &&
        entry.score >= top - NEAR_TOP_GAP
    )
    .map((entry) => entry.slug);
  return [...forced, ...semantic].slice(0, MAX_TAGS);
}

let running = false;

// Tag articles that have an embedding but no tags yet. Cosine math only —
// cheap enough to sweep the whole backlog in one pass.
export async function backfillTags(limit = 1000): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, title, summary, embedding FROM articles
         WHERE tags IS NULL AND embedding IS NOT NULL
         ORDER BY published_at DESC LIMIT ?`
      )
      .all(limit) as Array<{
      id: number;
      title: string;
      summary: string | null;
      embedding: Buffer;
    }>;
    if (rows.length === 0) return 0;

    const update = db.prepare("UPDATE articles SET tags = ? WHERE id = ?");
    for (const row of rows) {
      const tags = await assignTags(
        bufferToVector(row.embedding),
        `${row.title}. ${row.summary ?? ""}`
      );
      update.run(JSON.stringify(tags), row.id);
    }
    return rows.length;
  } catch (error) {
    console.error("[tags] backfill failed:", error);
    return 0;
  } finally {
    running = false;
  }
}
