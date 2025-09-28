import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Code, Server, Shield, Zap } from "lucide-react";

const TechnicalSpecs = () => {
  const specs = [
    {
      category: "Architecture Pattern",
      icon: Server,
      items: [
        { label: "Design", value: "Event-Driven Serverless" },
        { label: "Communication", value: "REST APIs + Message Queues" },
        { label: "Scaling", value: "Auto-scaling based on demand" },
        { label: "Deployment", value: "Infrastructure as Code (ARM/Bicep)" }
      ]
    },
    {
      category: "Security & Compliance",
      icon: Shield,
      items: [
        { label: "Authentication", value: "Azure AD B2C" },
        { label: "Data Encryption", value: "TLS 1.3 + AES-256" },
        { label: "Access Control", value: "RBAC + Managed Identity" },
        { label: "Compliance", value: "SOC 2, GDPR, HIPAA" }
      ]
    },
    {
      category: "Performance & Reliability",
      icon: Zap,
      items: [
        { label: "Availability", value: "99.99% SLA" },
        { label: "Response Time", value: "< 200ms for API calls" },
        { label: "Throughput", value: "1000+ documents/hour" },
        { label: "Recovery", value: "RTO < 4 hours, RPO < 1 hour" }
      ]
    },
    {
      category: "Development & Operations",
      icon: Code,
      items: [
        { label: "Languages", value: "C#, Python, JavaScript" },
        { label: "CI/CD", value: "Azure DevOps Pipelines" },
        { label: "Monitoring", value: "Application Insights" },
        { label: "Logging", value: "Centralized with Log Analytics" }
      ]
    }
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {specs.map((spec, index) => {
        const Icon = spec.icon;
        return (
          <Card key={index} className="bg-gradient-card border-border/50 shadow-card hover:shadow-azure transition-all duration-300">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-azure/20">
                  <Icon className="w-5 h-5 text-azure" />
                </div>
                <CardTitle className="text-lg text-foreground">{spec.category}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {spec.items.map((item, itemIndex) => (
                  <div key={itemIndex} className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{item.label}</span>
                    <Badge variant="outline" className="border-azure/50 text-azure">
                      {item.value}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default TechnicalSpecs;