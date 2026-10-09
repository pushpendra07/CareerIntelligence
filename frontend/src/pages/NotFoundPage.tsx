import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <h1>Page not found</h1>
      <Link className="link mt-2 inline-block" to="/">Back to dashboard</Link>
    </div>
  );
}
