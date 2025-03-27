// --- MOCK BENCHMARK DATA ---
// In reality, this data would come from a database populated from a purchased
// data source or carefully aggregated (and anonymized) user data.
// Grouped by a simplified industry string.
const MOCK_BENCHMARKS_DB: Record<string, { metric: string; average: number }[]> = {
    "Software (SaaS)": [
        { metric: "grossProfitMargin", average: 75 },
        { metric: "netProfitMargin", average: 15 },
        { metric: "dso", average: 45 },
        // Add more relevant SaaS benchmarks
    ],
    "Professional Services": [
        { metric: "grossProfitMargin", average: 40 },
        { metric: "netProfitMargin", average: 12 },
        { metric: "dso", average: 55 },
    ],
    "Retail (E-commerce)": [
        { metric: "grossProfitMargin", average: 45 },
        { metric: "netProfitMargin", average: 5 },
        { metric: "dso", average: 10 }, // Often paid upfront
    ],
    "DEFAULT": [ // Fallback if industry not found
        { metric: "grossProfitMargin", average: 50 },
        { metric: "netProfitMargin", average: 10 },
        { metric: "dso", average: 50 },
    ],
};

interface IndustryBenchmark {
    metric: string;
    average: number;
    // Could add percentiles later: percentile_25?: number; percentile_75?: number;
}

class BenchmarkService {

    /**
     * MOCK: Gets the user's industry.
     * In reality, this would likely fetch from your user/organization profile in the DB.
     * @param organizationId
     * @returns A string representing the user's industry, or 'DEFAULT'.
     */
    async getUserIndustry(organizationId: string): Promise<string> {
        // TODO: Replace with actual DB lookup for organization's industry setting
        console.warn("[BenchmarkService] Using mock industry lookup. Implement DB fetch.");
        // Example: const orgProfile = await prisma.organization.findUnique({ where: { id: organizationId }, select: { industry: true } });
        // return orgProfile?.industry || "DEFAULT";

        // Mock implementation: return a fixed industry or cycle through them based on orgId for testing
        const mockIndustries = ["Software (SaaS)", "Professional Services", "Retail (E-commerce)"];
        const index = parseInt(organizationId.slice(-1), 16) % mockIndustries.length; // Pseudo-random selection
        return mockIndustries[index] || "DEFAULT";
    }

    /**
     * Fetches benchmark data for a given industry.
     * @param industry Industry string (e.g., from getUserIndustry)
     * @returns Array of benchmark metrics for that industry, or default benchmarks.
     */
    async getBenchmarks(industry: string): Promise<IndustryBenchmark[]> {
        console.log(`[BenchmarkService] Fetching benchmarks for industry: ${industry}`);
        return MOCK_BENCHMARKS_DB[industry] || MOCK_BENCHMARKS_DB["DEFAULT"] || [];
    }
}

export const benchmarkService = new BenchmarkService();