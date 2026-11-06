import { loadDataSources } from "@/app/lib/datasource.config.file";
import { checkDataSourcesHealth } from "@/app/lib/datasource-health";

export async function GET() {
  try {
    const report = await checkDataSourcesHealth(loadDataSources());

    return Response.json(report, {
      status: report.status === "ok" ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        status: "down",
        checkedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message
            : "Unable to load datasource configuration",
        sources: [],
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
