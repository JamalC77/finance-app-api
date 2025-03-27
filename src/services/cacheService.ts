// Simple in-memory cache implementation
// TODO: Replace with Redis or other persistent cache solution in production

class CacheService {
    private cache: Map<string, { value: any; expiry: number }> = new Map();

    async get<T>(key: string): Promise<T | null> {
        const item = this.cache.get(key);
        if (!item) return null;

        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return null;
        }

        return item.value as T;
    }

    async set(key: string, value: any, ttlSeconds: number): Promise<void> {
        this.cache.set(key, {
            value,
            expiry: Date.now() + (ttlSeconds * 1000)
        });
    }

    async delete(key: string): Promise<void> {
        this.cache.delete(key);
    }

    async clear(): Promise<void> {
        this.cache.clear();
    }
}

export const cacheService = new CacheService();