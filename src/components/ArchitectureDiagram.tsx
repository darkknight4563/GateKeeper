import { Card } from "@/components/ui/card";
import { FileUp, Database, Cpu, BarChart3, Cloud, ArrowRight } from "lucide-react";

const ArchitectureDiagram = () => {
  const services = [
    {
      id: "upload",
      name: "Document Upload",
      icon: FileUp,
      description: "Azure Blob Storage",
      position: { x: 50, y: 100 },
      color: "azure"
    },
    {
      id: "functions",
      name: "Processing Engine",
      icon: Cpu,
      description: "Azure Functions",
      position: { x: 300, y: 100 },
      color: "success"
    },
    {
      id: "ai",
      name: "Document Intelligence",
      icon: Cloud,
      description: "Azure AI Services",
      position: { x: 550, y: 100 },
      color: "warning"
    },
    {
      id: "database",
      name: "Data Storage",
      icon: Database,
      description: "Azure Cosmos DB",
      position: { x: 300, y: 250 },
      color: "error"
    },
    {
      id: "dashboard",
      name: "Results Dashboard",
      icon: BarChart3,
      description: "Web Interface",
      position: { x: 550, y: 250 },
      color: "azure"
    }
  ];

  const connections = [
    { from: "upload", to: "functions" },
    { from: "functions", to: "ai" },
    { from: "functions", to: "database" },
    { from: "database", to: "dashboard" }
  ];

  return (
    <div className="relative w-full h-96 bg-gradient-to-br from-secondary to-muted rounded-lg p-8 overflow-hidden">
      {/* Services */}
      {services.map((service) => {
        const Icon = service.icon;
        return (
          <Card
            key={service.id}
            className="absolute w-32 h-24 flex flex-col items-center justify-center bg-card/90 backdrop-blur-sm border-border/50 shadow-card hover:shadow-azure transition-all duration-300 hover:scale-105"
            style={{
              left: service.position.x,
              top: service.position.y,
            }}
          >
            <Icon className={`w-6 h-6 mb-2 text-${service.color}`} />
            <span className="text-xs font-medium text-center text-foreground">
              {service.name}
            </span>
            <span className="text-xs text-muted-foreground text-center">
              {service.description}
            </span>
          </Card>
        );
      })}

      {/* Connection Lines */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {connections.map((connection, index) => {
          const fromService = services.find(s => s.id === connection.from);
          const toService = services.find(s => s.id === connection.to);
          
          if (!fromService || !toService) return null;
          
          const fromX = fromService.position.x + 64; // center of card
          const fromY = fromService.position.y + 48;
          const toX = toService.position.x + 64;
          const toY = toService.position.y + 48;
          
          return (
            <line
              key={index}
              x1={fromX}
              y1={fromY}
              x2={toX}
              y2={toY}
              stroke="hsl(var(--azure-blue))"
              strokeWidth="2"
              strokeDasharray="5,5"
              className="animate-pulse"
            />
          );
        })}
      </svg>

      {/* Flow arrows */}
      <div className="absolute top-4 right-4 flex items-center gap-2 text-azure text-sm">
        <span>Data Flow</span>
        <ArrowRight className="w-4 h-4" />
      </div>
    </div>
  );
};

export default ArchitectureDiagram;