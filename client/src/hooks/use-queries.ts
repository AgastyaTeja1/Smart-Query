import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { QueryHistory, QueryExecutionResponse } from "@shared/schema";

export function useQueryHistory() {
  return useQuery<QueryHistory[]>({
    queryKey: ["/api/queries/history"],
  });
}

export function useExecuteQuery() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (query: string) => {
      const response = await apiRequest("POST", "/api/queries/execute", { query });
      return response.json() as Promise<QueryExecutionResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queries/history"] });
    },
  });
}

export function useClearHistory() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/queries/history");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queries/history"] });
    },
  });
}

export function useDatabaseConfig() {
  return useQuery({
    queryKey: ["/api/database/configs"],
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: async ({ type, connectionString }: { type: string; connectionString: string }) => {
      const response = await apiRequest("POST", "/api/database/test", {
        type,
        connectionString,
      });
      return response.json();
    },
  });
}

export function useSaveConfig() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (config: {
      name: string;
      type: string;
      connectionString: string;
      isActive: boolean;
    }) => {
      const response = await apiRequest("POST", "/api/database/configs", config);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/database/configs"] });
    },
  });
}
