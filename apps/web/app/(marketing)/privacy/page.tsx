import { LegalPage } from "../legal";

export const metadata = { title: "Privacy: DiffPanda", description: "What DiffPanda stores about you and your repositories." };

export default function Privacy() {
  return (
    <LegalPage title="Privacy" html={`<p>DiffPanda stores your GitHub user id, login, name, email and avatar when you sign in, and the installations and repositories you grant it.</p>
<p>For each review it stores the pull request number, commit, status, the findings it posted, token counts and timing. The diff itself is fetched from GitHub, sent to Anthropic (Claude) for the review and not stored by DiffPanda.</p>
<p>Payments are handled by Polar. DiffPanda stores the subscription id and status for each Pro repository, never card details.</p>
<p>Uninstalling the GitHub App deletes its installation, repositories and review history.</p>`} />
  );
}
