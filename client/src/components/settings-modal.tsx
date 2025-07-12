import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { X } from "lucide-react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [databaseType, setDatabaseType] = useState("sqlserver");
  const [connectionString, setConnectionString] = useState("");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [queryTimeout, setQueryTimeout] = useState("30");
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Load current configuration
  const { data: config } = useQuery({
    queryKey: ["/api/database/configs"],
    enabled: isOpen,
  });

  useEffect(() => {
    if (config && (config as any).activeConfig) {
      const activeConfig = (config as any).activeConfig;
      setDatabaseType(activeConfig.type);
      setConnectionString(activeConfig.connectionString);
    }
  }, [config]);

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/database/test", {
        type: databaseType,
        connectionString,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.success ? "Connection successful" : "Connection failed",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (error) => {
      toast({
        title: "Connection test failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/database/configs", {
        name: `${databaseType.toUpperCase()} Connection`,
        type: databaseType,
        connectionString,
        isActive: true,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/database/configs"] });
      toast({
        title: "Settings saved",
        description: "Database configuration has been saved successfully",
      });
      onClose();
    },
    onError: (error) => {
      toast({
        title: "Failed to save settings",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
    },
  });

  const handleTestConnection = () => {
    if (!connectionString.trim()) {
      toast({
        title: "Connection string required",
        description: "Please enter a connection string to test",
        variant: "destructive",
      });
      return;
    }
    testConnectionMutation.mutate();
  };

  const handleSaveSettings = () => {
    if (!connectionString.trim()) {
      toast({
        title: "Connection string required",
        description: "Please enter a connection string",
        variant: "destructive",
      });
      return;
    }
    saveSettingsMutation.mutate();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Database Settings</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-6 w-6"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>
        
        <div className="space-y-6">
          <div>
            <Label htmlFor="database-type" className="text-sm font-medium">
              Database Type
            </Label>
            <Select value={databaseType} onValueChange={setDatabaseType}>
              <SelectTrigger className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sqlserver">SQL Server</SelectItem>
                <SelectItem value="postgresql">PostgreSQL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div>
            <Label htmlFor="connection-string" className="text-sm font-medium">
              Connection String
            </Label>
            <Input
              id="connection-string"
              type="password"
              value={connectionString}
              onChange={(e) => setConnectionString(e.target.value)}
              placeholder={
                databaseType === 'sqlserver' 
                  ? "Server=localhost;Database=mydb;Integrated Security=true;" 
                  : "postgresql://username:password@localhost:5432/database"
              }
              className="mt-2"
            />
          </div>
          
          <div>
            <Label htmlFor="openai-key" className="text-sm font-medium">
              OpenAI API Key
            </Label>
            <Input
              id="openai-key"
              type="password"
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              placeholder="sk-..."
              className="mt-2"
            />
            <p className="text-xs text-slate-500 mt-1">
              Your API key is stored securely and never logged
            </p>
          </div>
          
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div>
              <h4 className="text-sm font-medium text-slate-900">Query Timeout</h4>
              <p className="text-xs text-slate-500">Maximum execution time for queries</p>
            </div>
            <Select value={queryTimeout} onValueChange={setQueryTimeout}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 seconds</SelectItem>
                <SelectItem value="60">1 minute</SelectItem>
                <SelectItem value="300">5 minutes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <div className="flex justify-end space-x-3 pt-6 border-t">
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testConnectionMutation.isPending || !connectionString.trim()}
          >
            {testConnectionMutation.isPending ? "Testing..." : "Test Connection"}
          </Button>
          <Button
            onClick={handleSaveSettings}
            disabled={saveSettingsMutation.isPending || !connectionString.trim()}
          >
            {saveSettingsMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
