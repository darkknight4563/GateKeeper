import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
  Hr,
} from 'https://esm.sh/@react-email/components@0.0.22'
import * as React from 'https://esm.sh/react@18.3.1'

interface ApprovalNotificationEmailProps {
  document_title: string
  supplier_name: string
  current_state: string
  previous_state?: string
  next_approver?: string
  actor_name: string
  comment?: string
  next_action: string
  report_url: string
}

export const ApprovalNotificationEmail = ({
  document_title,
  supplier_name,
  current_state,
  previous_state,
  next_approver,
  actor_name,
  comment,
  next_action,
  report_url,
}: ApprovalNotificationEmailProps) => {
  const stateColors: Record<string, string> = {
    pending: '#f59e0b',
    approved: '#10b981',
    rejected: '#ef4444',
    revised: '#3b82f6',
  }

  const stateColor = stateColors[current_state] || '#6b7280'

  return (
    <Html>
      <Head />
      <Preview>
        {supplier_name} - Status {current_state.toUpperCase()}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>ClarityChain AI</Heading>
          
          <Section style={statusBadge}>
            <Text style={{ ...statusText, backgroundColor: stateColor }}>
              Status: {current_state.toUpperCase()}
            </Text>
          </Section>

          <Heading style={h2}>{supplier_name}</Heading>
          
          <Text style={text}>
            <strong>Document:</strong> {document_title}
          </Text>

          {previous_state && (
            <Text style={text}>
              <strong>State Change:</strong> {previous_state} → {current_state}
            </Text>
          )}

          <Text style={text}>
            <strong>Updated by:</strong> {actor_name}
          </Text>

          {comment && (
            <Section style={commentBox}>
              <Text style={{ ...text, margin: 0 }}>
                <strong>Comment:</strong>
              </Text>
              <Text style={{ ...text, marginTop: '8px', fontStyle: 'italic' }}>
                "{comment}"
              </Text>
            </Section>
          )}

          <Hr style={hr} />

          <Text style={{ ...text, fontWeight: 'bold' }}>
            Next Step:
          </Text>
          <Text style={{ ...text, marginTop: '8px' }}>
            {next_action}
          </Text>

          {next_approver && (
            <Text style={text}>
              <strong>Next Approver:</strong> {next_approver}
            </Text>
          )}

          <Section style={buttonContainer}>
            <Link
              href={report_url}
              target="_blank"
              style={button}
            >
              Open in ClarityChain
            </Link>
          </Section>

          <Hr style={hr} />

          <Text style={footer}>
            This is an automated notification from{' '}
            <Link
              href="https://claritychain.ai"
              target="_blank"
              style={{ ...link, color: '#898989' }}
            >
              ClarityChain AI
            </Link>
            {' '}Procurement Analysis Platform
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default ApprovalNotificationEmail

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
}

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
  borderRadius: '8px',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
}

const h1 = {
  color: '#1a1a1a',
  fontSize: '32px',
  fontWeight: 'bold',
  margin: '40px 0 20px',
  padding: '0 40px',
  textAlign: 'center' as const,
}

const h2 = {
  color: '#333',
  fontSize: '24px',
  fontWeight: 'bold',
  margin: '20px 0',
  padding: '0 40px',
}

const text = {
  color: '#333',
  fontSize: '16px',
  lineHeight: '26px',
  margin: '16px 0',
  padding: '0 40px',
}

const statusBadge = {
  textAlign: 'center' as const,
  margin: '20px 0',
}

const statusText = {
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 'bold',
  padding: '8px 16px',
  borderRadius: '20px',
  display: 'inline-block',
  textTransform: 'uppercase' as const,
}

const commentBox = {
  backgroundColor: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '16px',
  margin: '20px 40px',
}

const hr = {
  borderColor: '#e6ebf1',
  margin: '20px 40px',
}

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '32px 0',
}

const button = {
  backgroundColor: '#1a1a1a',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 32px',
}

const link = {
  color: '#2754C5',
  fontSize: '14px',
  textDecoration: 'underline',
}

const footer = {
  color: '#898989',
  fontSize: '12px',
  lineHeight: '22px',
  margin: '32px 0',
  padding: '0 40px',
  textAlign: 'center' as const,
}
