/**
 * Small pages linked from the footer. Like the landing page, their markup is injected as static HTML: the
 * kit's scripts edit this DOM (link arrows, nav state), and React must not hydrate and then re-render it.
 */
export function LegalPage({ title, html }: { title: string; html: string }) {
  const header = `<div class="wrap nav__bar">
    <a class="nav__logo" href="/"><span class="mark" data-mark="stack" aria-hidden="true"></span>PullPanda</a>
    <div class="nav__actions"><a class="btn btn--secondary" href="/">Back to the home page</a></div>
  </div>`;
  const main = `<section class="section legal"><div class="wrap stack-6 measure"><h1>${title}</h1>${html}</div></section>`;
  return (
    <>
      <header className="nav" dangerouslySetInnerHTML={{ __html: header }} />
      <main id="top" dangerouslySetInnerHTML={{ __html: main }} />
    </>
  );
}
