// In-memory cache scoped to one dashboard session; no employee data is persisted.
export function createAttendanceCache() {
  const requests = new Map<string, Promise<Response>>();
  return {
    clear() { requests.clear(); },
    async fetch(url: string): Promise<Response> {
      let request = requests.get(url);
      if (!request) {
        request = fetch(url, { cache: "no-store" });
        requests.set(url, request);
      }
      try {
        const response = await request;
        if (!response.ok && requests.get(url) === request) requests.delete(url);
        return response.clone();
      } catch (error) {
        if (requests.get(url) === request) requests.delete(url);
        throw error;
      }
    },
  };
}
