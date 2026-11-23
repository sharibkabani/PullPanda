import { LegalPage } from "../legal";

export const metadata = { title: "Terms: DiffPanda", description: "The terms for using DiffPanda reviews and Pro subscriptions." };

export default function Terms() {
  return (
    <LegalPage title="Terms" html={`<p>DiffPanda posts automated review comments. They can be wrong; a person on your team decides what to merge.</p>
<p>The free plan covers public repositories up to 30 reviews a month per account. Pro is billed monthly per repository through Polar and can be cancelled at any time; it stays active until the end of the paid month.</p>
<p>Do not install DiffPanda on repositories you are not allowed to share with a third-party service.</p>`} />
  );
}
