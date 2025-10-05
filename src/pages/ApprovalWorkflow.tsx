import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, Bell, ListTodo, Settings } from "lucide-react";
import WorkflowDashboard from "@/components/workflow/WorkflowDashboard";
import NotificationCenter from "@/components/workflow/NotificationCenter";
import ActionItemsManager from "@/components/workflow/ActionItemsManager";
import TaskSyncConfig from "@/components/workflow/TaskSyncConfig";

const ApprovalWorkflow = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Approval Workflow</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage approvals, notifications, and action items
            </p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <Tabs defaultValue="workflows" className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-8">
            <TabsTrigger value="workflows">
              <CheckCircle className="h-4 w-4 mr-2" />
              Workflows
            </TabsTrigger>
            <TabsTrigger value="notifications">
              <Bell className="h-4 w-4 mr-2" />
              Notifications
            </TabsTrigger>
            <TabsTrigger value="actions">
              <ListTodo className="h-4 w-4 mr-2" />
              Action Items
            </TabsTrigger>
            <TabsTrigger value="config">
              <Settings className="h-4 w-4 mr-2" />
              Task Sync
            </TabsTrigger>
          </TabsList>

          <TabsContent value="workflows" className="space-y-8">
            <div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">Approval Workflows</h3>
              <p className="text-muted-foreground mb-6">
                View and manage all approval workflows for your procurement documents.
              </p>
              <WorkflowDashboard />
            </div>
          </TabsContent>

          <TabsContent value="notifications" className="space-y-8">
            <div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">Notification Center</h3>
              <p className="text-muted-foreground mb-6">
                Send approval notifications and track delivery status.
              </p>
              <NotificationCenter />
            </div>
          </TabsContent>

          <TabsContent value="actions" className="space-y-8">
            <div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">Action Items</h3>
              <p className="text-muted-foreground mb-6">
                Track and manage action items generated from workflows.
              </p>
              <ActionItemsManager />
            </div>
          </TabsContent>

          <TabsContent value="config" className="space-y-8">
            <div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">Task Sync Configuration</h3>
              <p className="text-muted-foreground mb-6">
                Configure integrations with external task management systems.
              </p>
              <TaskSyncConfig />
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default ApprovalWorkflow;
