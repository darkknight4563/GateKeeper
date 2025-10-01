# Deployment Guide

## Overview

This guide covers deploying a Lovable project (React + Vite + Supabase) using Docker and CI/CD.

## Architecture

- **Frontend**: React + Vite (served via Nginx in Docker)
- **Backend**: Supabase Edge Functions (Deno runtime, deployed separately)
- **Database**: Supabase PostgreSQL (managed service)

## Docker Deployment

### 1. Build Docker Image

```bash
# Build the image
docker build -t vendor-comparison-app:latest .

# Run locally
docker run -p 3000:80 vendor-comparison-app:latest
```

### 2. Docker Compose (Development)

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

Services available:
- Frontend: http://localhost:3000
- Supabase Studio: http://localhost:3001
- PostgreSQL: localhost:5432

### 3. Environment Variables

Create a `.env.production` file:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
```

## CI/CD Pipeline (GitHub Actions)

### Setup Steps

1. **Add GitHub Secrets** (Repository Settings → Secrets and variables → Actions):
   - `SUPABASE_ACCESS_TOKEN`: Get from Supabase Dashboard → Settings → API
   - `SUPABASE_PROJECT_ID`: Your project reference ID
   - `VERCEL_TOKEN`: (Optional) For Vercel deployment
   - `VERCEL_ORG_ID`: (Optional) Your Vercel organization ID
   - `VERCEL_PROJECT_ID`: (Optional) Your Vercel project ID

2. **Enable GitHub Packages**:
   - The workflow pushes Docker images to GitHub Container Registry (ghcr.io)
   - Images are automatically tagged with branch name, SHA, and version

3. **Pipeline Stages**:

   **Stage 1: Test and Lint**
   - Runs on every push and pull request
   - Executes linter, type checking, and build
   - Must pass before deployment

   **Stage 2: Build and Push Docker Image**
   - Runs only on `main` branch pushes
   - Builds multi-stage Docker image
   - Pushes to GitHub Container Registry
   - Uses layer caching for faster builds

   **Stage 3: Deploy Edge Functions**
   - Runs only on `main` branch pushes
   - Deploys Supabase Edge Functions
   - Uses Supabase CLI

   **Stage 4: Deploy Frontend**
   - Runs after successful Docker build
   - Deploys to Vercel/Netlify (configurable)
   - Alternative: Deploy to AWS ECS, GCP Cloud Run, etc.

## Cloud Deployment Options

### Option 1: GitHub Container Registry + Cloud Run

```bash
# Pull image from GitHub Packages
docker pull ghcr.io/your-username/your-repo:latest

# Deploy to Google Cloud Run
gcloud run deploy vendor-comparison-app \
  --image ghcr.io/your-username/your-repo:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

### Option 2: AWS ECS

```bash
# Tag image for ECR
docker tag vendor-comparison-app:latest \
  123456789.dkr.ecr.us-east-1.amazonaws.com/vendor-comparison-app:latest

# Push to ECR
docker push 123456789.dkr.ecr.us-east-1.amazonaws.com/vendor-comparison-app:latest

# Update ECS service (use AWS CLI or console)
```

### Option 3: Lovable Platform (Recommended)

The easiest option is to use Lovable's built-in deployment:

1. Go to Lovable Project → Share → Publish
2. Lovable automatically handles deployment
3. Custom domains available in Project → Settings → Domains

## Supabase Edge Functions Deployment

Edge functions are deployed separately from the frontend:

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to your project
supabase link --project-ref your-project-id

# Deploy all functions
supabase functions deploy

# Deploy specific function
supabase functions deploy document-processor
```

## Monitoring and Logging

### Docker Logs

```bash
# View container logs
docker logs -f container-id

# View compose logs
docker-compose logs -f frontend
```

### Supabase Logs

- Access logs in Supabase Dashboard → Logs
- Monitor Edge Function executions
- Track database queries and performance

### GitHub Actions

- View workflow runs in GitHub → Actions tab
- Check build logs, test results
- Monitor deployment status

## Best Practices

1. **Security**:
   - Never commit secrets to repository
   - Use GitHub Secrets for sensitive data
   - Rotate API keys regularly
   - Enable branch protection rules

2. **Performance**:
   - Use Docker layer caching
   - Optimize image size with multi-stage builds
   - Enable CDN for static assets
   - Use Nginx gzip compression

3. **Reliability**:
   - Implement health checks
   - Set up automatic retries
   - Monitor application metrics
   - Use rollback strategies

4. **Cost Optimization**:
   - Use appropriate instance sizes
   - Implement auto-scaling
   - Cache dependencies
   - Clean up old Docker images

## Troubleshooting

### Build Failures

```bash
# Clear Docker cache
docker builder prune

# Rebuild without cache
docker build --no-cache -t vendor-comparison-app:latest .
```

### Edge Function Errors

```bash
# Test locally
supabase functions serve document-processor

# Check logs
supabase functions logs document-processor
```

### Environment Issues

- Verify environment variables are set correctly
- Check CORS configuration
- Ensure Supabase URL and keys match
