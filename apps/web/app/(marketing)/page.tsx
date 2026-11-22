import { loadLanding } from "@/lib/landing";

export default function LandingPage() {
  const { header, main, footer } = loadLanding();
  return (
    <>
      <header className="nav nav--centre" dangerouslySetInnerHTML={{ __html: header }} />
      <main id="top" dangerouslySetInnerHTML={{ __html: main }} />
      <footer
        className="footer closing footer--dark ground-inverse"
        id="contact"
        aria-labelledby="close-h"
        dangerouslySetInnerHTML={{ __html: footer }}
      />
    </>
  );
}
