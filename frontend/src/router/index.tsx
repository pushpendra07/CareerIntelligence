import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { AppLayout } from "../layouts/AppLayout";
import { NotFoundPage } from "../pages/NotFoundPage";

/** Each page is loaded on demand (route-level code splitting). */
function page<M>(load: () => Promise<M>, pick: (m: M) => React.ComponentType): Pick<RouteObject, "lazy"> {
  return { lazy: async () => ({ Component: pick(await load()) }) };
}

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, ...page(() => import("../features/dashboard/DashboardPage"), (m) => m.DashboardPage) },
      { path: "jobs", ...page(() => import("../features/jobs/JobsPage"), (m) => m.JobsPage) },
      { path: "jobs/closed", ...page(() => import("../features/jobs/JobsPage"), (m) => () => <m.JobsPage view="closed" />) },
      { path: "jobs/new", ...page(() => import("../features/jobs/AddJobPage"), (m) => m.AddJobPage) },
      { path: "jobs/:id", ...page(() => import("../features/jobs/JobDetailPage"), (m) => m.JobDetailPage) },
      { path: "jobs/:id/prep", ...page(() => import("../features/interviews/PrepPage"), (m) => () => <m.PrepPage kind="job" />) },
      { path: "companies", ...page(() => import("../features/companies/CompaniesPage"), (m) => m.CompaniesPage) },
      { path: "companies/:id", ...page(() => import("../features/companies/CompanyDetailPage"), (m) => m.CompanyDetailPage) },
      { path: "applications", ...page(() => import("../features/applications/ApplicationsPage"), (m) => m.ApplicationsPage) },
      { path: "applications/:id", ...page(() => import("../features/applications/ApplicationsPage"), (m) => m.ApplicationDetailPage) },
      { path: "interviews", ...page(() => import("../features/interviews/InterviewsPage"), (m) => m.InterviewsPage) },
      { path: "interviews/new", ...page(() => import("../features/interviews/InterviewsPage"), (m) => m.NewInterviewPage) },
      { path: "interviews/:id", ...page(() => import("../features/interviews/InterviewsPage"), (m) => m.InterviewDetailPage) },
      { path: "interviews/:id/prep", ...page(() => import("../features/interviews/PrepPage"), (m) => () => <m.PrepPage kind="interview" />) },
      { path: "questions", ...page(() => import("../features/questions/QuestionsPage"), (m) => m.QuestionsPage) },
      { path: "offers", ...page(() => import("../features/offers/OffersPage"), (m) => m.OffersPage) },
      { path: "followups", ...page(() => import("../features/followups/FollowupsPage"), (m) => m.FollowupsPage) },
      { path: "recruiters", ...page(() => import("../features/recruiters/RecruitersPage"), (m) => m.RecruitersPage) },
      { path: "cvs", ...page(() => import("../features/cvs/CVsPage"), (m) => m.CVsPage) },
      { path: "cvs/:id", ...page(() => import("../features/cvs/CVDetailPage"), (m) => m.CVDetailPage) },
      { path: "profile", ...page(() => import("../features/profile/ProfilePage"), (m) => m.ProfilePage) },
      { path: "preferences", ...page(() => import("../features/profile/PreferencesPage"), (m) => m.PreferencesPage) },
      { path: "analytics", ...page(() => import("../features/analytics/AnalyticsPage"), (m) => m.AnalyticsPage) },
      { path: "settings", ...page(() => import("../features/settings/SettingsPage"), (m) => m.SettingsPage) },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
