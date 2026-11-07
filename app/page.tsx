import { HealthProvider } from "@/app/components/health-provider";
import { SiteFooter } from "@/app/components/site-footer";
import { SiteHeader } from "@/app/components/site-header";
import { Capabilities } from "@/app/components/sections/capabilities";
import { Hero } from "@/app/components/sections/hero";
import { Integrations } from "@/app/components/sections/integrations";
import { LiveStatus } from "@/app/components/sections/live-status";
import { Workflow } from "@/app/components/sections/workflow";
import { DiagnosticWorkspace } from "@/app/components/workspace/diagnostic-workspace";

export default function Home() {
  return (
    <HealthProvider>
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <Integrations />
        <Capabilities />
        <Workflow />
        <LiveStatus />
        <DiagnosticWorkspace />
      </main>
      <SiteFooter />
    </HealthProvider>
  );
}
