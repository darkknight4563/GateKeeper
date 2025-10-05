-- Create enum for approval states
CREATE TYPE public.approval_state AS ENUM ('pending', 'approved', 'rejected', 'revised');

-- Create enum for user roles
CREATE TYPE public.user_role AS ENUM ('analyst', 'manager', 'director', 'admin');

-- Create approval workflows table
CREATE TABLE public.approval_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  vendor_offer_id UUID REFERENCES public.vendor_offers(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL,
  current_state approval_state NOT NULL DEFAULT 'pending',
  current_approver_id UUID REFERENCES auth.users(id),
  approval_chain JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create approval audit logs table
CREATE TABLE public.approval_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.approval_workflows(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  actor_name TEXT NOT NULL,
  actor_role user_role,
  previous_state approval_state,
  new_state approval_state NOT NULL,
  action TEXT NOT NULL,
  comment TEXT,
  digital_signature TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.approval_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for approval_workflows
CREATE POLICY "Users can view workflows for their documents"
ON public.approval_workflows
FOR SELECT
USING (
  document_id IN (
    SELECT id FROM public.documents WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can create workflows for their documents"
ON public.approval_workflows
FOR INSERT
WITH CHECK (
  document_id IN (
    SELECT id FROM public.documents WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can update workflows for their documents"
ON public.approval_workflows
FOR UPDATE
USING (
  document_id IN (
    SELECT id FROM public.documents WHERE user_id = auth.uid()
  )
);

-- RLS policies for approval_audit_logs
CREATE POLICY "Users can view audit logs for their workflows"
ON public.approval_audit_logs
FOR SELECT
USING (
  workflow_id IN (
    SELECT w.id FROM public.approval_workflows w
    JOIN public.documents d ON w.document_id = d.id
    WHERE d.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create audit logs for their workflows"
ON public.approval_audit_logs
FOR INSERT
WITH CHECK (
  workflow_id IN (
    SELECT w.id FROM public.approval_workflows w
    JOIN public.documents d ON w.document_id = d.id
    WHERE d.user_id = auth.uid()
  )
);

-- Create trigger for updated_at
CREATE TRIGGER update_approval_workflows_updated_at
BEFORE UPDATE ON public.approval_workflows
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_approval_workflows_document_id ON public.approval_workflows(document_id);
CREATE INDEX idx_approval_workflows_state ON public.approval_workflows(current_state);
CREATE INDEX idx_approval_audit_logs_workflow_id ON public.approval_audit_logs(workflow_id);
CREATE INDEX idx_approval_audit_logs_actor_id ON public.approval_audit_logs(actor_id);
