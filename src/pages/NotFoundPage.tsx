import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";

export function NotFoundPage() {
  return (
    <div>
      <PageHeader title="Page not found" eyebrow="ACP Deal Room" />
      <Link className="text-sm font-medium text-acp-bronze hover:text-white transition-colors" to="/deals">
        Return to deals
      </Link>
    </div>
  );
}
