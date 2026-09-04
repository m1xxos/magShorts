# Tests

```
npm test          # build, then everything
npm run test:api  # the HTTP API, against a server this suite starts
npm run test:e2e  # the same server, driven in a browser
```

Both suites boot a real magShorts on their own port over a temporary database
they seed themselves (`tests/support/app.ts`), so they never read or write the
database you are developing against.

Two things worth knowing before adding to them.

**They run `next start`, not `next dev`**, for two reasons. Next refuses a
second dev server in the same directory, so anything using `next dev` would
fail whenever you had one running — which is always. And the dev server does
not behave like the thing that ships: the bug these tests were written after
(searching again from the results page) worked perfectly in `next dev` and was
broken in every production build. **So run `npm run build` before `test:e2e`,
or you are testing the previous commit.** `npm test` does it for you.

**Every case in `browser.test.ts` is a bug that happened.** They are not there
to describe the feature; they are there because something shipped or nearly
shipped broken, and each one escaped the same way — checked by hand, once,
from one starting page, in one direction. Adding to them is cheap; the harness
gives you a logged-in page in three lines.
