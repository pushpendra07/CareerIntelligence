import { Link } from "react-router-dom";
import { Card, PageIntro } from "../../components/ui";
import { SavedAnswers } from "../jobs/ApplyAssistant";

/** My profile → Application details: what the Job collector extension fills into application forms. */
export function ApplicationDetailsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1>Application details</h1>
        <PageIntro>
          What job application forms ask for, saved once. The <b>Job collector</b> Chrome extension reads these from the app
          whenever you click <b>Fill this application</b> on a form — every page of it — and the Apply assistant on each job shows them
          with copy buttons. Empty name and contact fields use what's on <Link className="link" to="/profile">your profile</Link>;
          get the extension in <Link className="link" to="/settings">Settings → Job sources</Link>.
        </PageIntro>
      </div>
      <Card title="Your details">
        <SavedAnswers />
      </Card>
    </div>
  );
}
