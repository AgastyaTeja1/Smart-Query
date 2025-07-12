import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RotateCcw, Trash2, CheckCircle, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import type { QueryHistory } from "@shared/schema";

interface QueryHistoryProps {
  onQuerySelect: (query: string) => void;
}

export default function QueryHistory({ onQuerySelect }: QueryHistoryProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: history = [], isLoading } = useQuery<QueryHistory[]>({
    queryKey: ["/api/queries/history"],
  });

  const clearHistoryMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/queries/history");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queries/history"] });
      toast({
        title: "History cleared",
        description: "Query history has been cleared successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to clear history",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
    },
  });

  const handleClearHistory = () => {
    clearHistoryMutation.mutate();
  };

  const handleRerunQuery = (query: QueryHistory) => {
    onQuerySelect(query.naturalQuery);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-900">Recent Queries</h3>
          </div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-16 bg-slate-200 rounded-lg"></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Recent Queries</h3>
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearHistory}
              disabled={clearHistoryMutation.isPending}
              className="flex items-center space-x-1"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear History</span>
            </Button>
          )}
        </div>
        
        {history.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            <p>No query history yet</p>
            <p className="text-sm mt-1">Your executed queries will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((query) => (
              <div
                key={query.id}
                className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:border-slate-300 transition-colors cursor-pointer"
                onClick={() => handleRerunQuery(query)}
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900 line-clamp-2">
                    {query.naturalQuery}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {query.createdAt && formatDistanceToNow(new Date(query.createdAt), { addSuffix: true })} •{' '}
                    {query.status === 'success' 
                      ? `${query.rowCount} row${query.rowCount !== 1 ? 's' : ''}`
                      : 'Error'
                    } •{' '}
                    {query.executionTime ? `${(query.executionTime / 1000).toFixed(2)}s` : 'N/A'}
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge
                    variant={query.status === 'success' ? 'default' : 'destructive'}
                    className="flex items-center space-x-1"
                  >
                    {query.status === 'success' ? (
                      <CheckCircle className="w-3 h-3" />
                    ) : (
                      <XCircle className="w-3 h-3" />
                    )}
                    <span>{query.status === 'success' ? 'Success' : 'Error'}</span>
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRerunQuery(query);
                    }}
                    className="h-8 w-8"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
