// Sends a spinning clone of a card along a boomerang arc into a target
// element, then pulses the target and pops a little particle burst.

const BURST_COLORS = ["#c96442", "#e0b23f", "#7d9a6d", "#6d87a8"];

function cubicBezier(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number
): number {
  const u = 1 - t;
  return (
    u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
  );
}

export function flyBoomerang(
  source: HTMLElement,
  target: HTMLElement
): Promise<void> {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    pulseTarget(target);
    return Promise.resolve();
  }

  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const start = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
  const end = { x: to.left + to.width / 2, y: to.top + to.height / 2 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  const ghost = source.cloneNode(true) as HTMLElement;
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: "0",
    zIndex: "60",
    pointerEvents: "none",
    willChange: "transform, opacity",
    transformOrigin: "center",
  });
  document.body.appendChild(ghost);

  // Control points: swing out to the left and dip before looping up and
  // curving into the target — the boomerang round trip.
  const p1 = { x: -Math.min(from.width, 460) * 1.1, y: from.height * 0.45 };
  const p2 = { x: dx * 0.25, y: dy - 320 };

  const STEPS = 48;
  const TURNS = -2;
  const keyframes: Keyframe[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const e = 1 - Math.pow(1 - t, 1.7);
    const x = cubicBezier(0, p1.x, p2.x, dx, e);
    const y = cubicBezier(0, p1.y, p2.y, dy, e);
    const scale = Math.max(1 - 0.94 * e * e, 0.06);
    keyframes.push({
      transform: `translate(${x}px, ${y}px) rotate(${360 * TURNS * e}deg) scale(${scale})`,
      opacity: t > 0.85 ? 1 - ((t - 0.85) / 0.15) * 0.5 : 1,
    });
  }

  return new Promise((resolve) => {
    const flight = ghost.animate(keyframes, {
      duration: 1150,
      easing: "linear",
      fill: "forwards",
    });
    flight.onfinish = () => {
      ghost.remove();
      pulseTarget(target);
      burst(end.x, end.y);
      resolve();
    };
  });
}

function pulseTarget(target: HTMLElement) {
  target.animate(
    [
      { transform: "scale(1)", boxShadow: "0 0 0 0 rgba(201, 100, 66, 0.55)" },
      {
        transform: "scale(1.4) rotate(-6deg)",
        boxShadow: "0 0 0 10px rgba(201, 100, 66, 0.25)",
        offset: 0.35,
      },
      { transform: "scale(1)", boxShadow: "0 0 0 18px rgba(201, 100, 66, 0)" },
    ],
    { duration: 550, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }
  );
}

function burst(x: number, y: number) {
  for (let i = 0; i < 12; i++) {
    const dot = document.createElement("span");
    const size = 4 + Math.random() * 5;
    Object.assign(dot.style, {
      position: "fixed",
      left: `${x}px`,
      top: `${y}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: "50%",
      background: BURST_COLORS[i % BURST_COLORS.length],
      zIndex: "60",
      pointerEvents: "none",
    });
    document.body.appendChild(dot);
    const angle = (Math.PI * 2 * i) / 12 + Math.random() * 0.5;
    const distance = 28 + Math.random() * 46;
    dot
      .animate(
        [
          { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
          {
            transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${Math.sin(angle) * distance}px)) scale(0.3)`,
            opacity: 0,
          },
        ],
        {
          duration: 500 + Math.random() * 200,
          easing: "cubic-bezier(0.1, 0.6, 0.3, 1)",
          fill: "forwards",
        }
      )
      .addEventListener("finish", () => dot.remove());
  }
}
