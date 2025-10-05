import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface ActionItem {
  label: string;
  task: string;
  priority: "high" | "medium" | "low";
  assignee?: string;
}

interface Workflow {
  id: string;
  supplier_name: string;
  document_id: string;
}

const ActionItemsManager = () => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState("");
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const fetchWorkflows = async () => {
      try {
        const { data, error } = await supabase
          .from("approval_workflows")
          .select("id, supplier_name, document_id")
          .order("created_at", { ascending: false });

        if (error) throw error;
        setWorkflows(data || []);
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchWorkflows();
  }, []);

  const handleGenerateActionItems = async () => {
    if (!selectedWorkflow) {
      toast({
        title: "Validation Error",
        description: "Please select a workflow",
        variant: "destructive",
      });
      return;
    }

    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-action-items", {
        body: {
          workflow_id: selectedWorkflow,
        },
      });

      if (error) throw error;

      setActionItems(data.action_items || []);
      toast({
        title: "Success",
        description: `Generated ${data.action_items?.length || 0} action items`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const getPriorityBadge = (priority: string) => {
    const variants: Record<string, any> = {
      high: "destructive",
      medium: "secondary",
      low: "outline",
    };
    return <Badge variant={variants[priority] || "outline"}>{priority}</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" />
            Generate Action Items
          </CardTitle>
          <CardDescription>
            AI-powered action item generation based on workflow context
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workflow-select">Select Workflow</Label>
            <Select value={selectedWorkflow} onValueChange={setSelectedWorkflow}>
              <SelectTrigger id="workflow-select">
                <SelectValue placeholder="Choose a workflow..." />
              </SelectTrigger>
              <SelectContent>
                {workflows.map((workflow) => (
                  <SelectItem key={workflow.id} value={workflow.id}>
                    {workflow.supplier_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleGenerateActionItems} disabled={generating} className="w-full">
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Generate Action Items
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {actionItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Generated Action Items</CardTitle>
            <CardDescription>{actionItems.length} items generated</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {actionItems.map((item, index) => (
                <div key={index} className="border border-border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-foreground">{item.label}</h4>
                    {getPriorityBadge(item.priority)}
                  </div>
                  <p className="text-sm text-muted-foreground">{item.task}</p>
                  {item.assignee && (
                    <p className="text-xs text-muted-foreground">Assignee: {item.assignee}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Active Action Items</CardTitle>
          <CardDescription>Track and manage ongoing tasks</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Active action items will be displayed here. Mark items as complete, reassign, or update
            status.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default ActionItemsManager;
