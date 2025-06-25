#!/bin/bash

# Enhanced Research Agent - Deploy and Test Script
# This script deploys the entire enhanced system and runs comprehensive tests

set -e  # Exit on any error

echo "🚀 Enhanced Research Agent - Deploy and Test"
echo "============================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    # Check Node.js (for tests)
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js first."
        exit 1
    fi
    
    print_success "All prerequisites are installed"
}

# Stop any existing containers
cleanup_existing() {
    print_status "Cleaning up existing containers..."
    
    # Stop and remove containers
    docker-compose down --remove-orphans --volumes 2>/dev/null || true
    
    # Remove any dangling containers
    docker rm -f research-backend research-frontend research-redis research-monitoring 2>/dev/null || true
    
    print_success "Cleanup completed"
}

# Install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    
    # Backend dependencies
    cd agent-js
    if [ -f "package.json" ]; then
        npm install
        print_success "Backend dependencies installed"
    else
        print_warning "No package.json found in agent-js directory"
    fi
    cd ..
    
    # Frontend dependencies
    cd ui
    if [ -f "package.json" ]; then
        npm install
        print_success "Frontend dependencies installed"
    else
        print_warning "No package.json found in ui directory"
    fi
    cd ..
    
    # Test dependencies
    cd tests
    if [ ! -f "package.json" ]; then
        echo '{
  "name": "integration-tests",
  "version": "1.0.0",
  "dependencies": {
    "node-fetch": "^2.6.7"
  }
}' > package.json
    fi
    npm install
    print_success "Test dependencies installed"
    cd ..
}

# Create environment file if it doesn't exist
create_env_file() {
    if [ ! -f ".env" ]; then
        print_status "Creating environment file..."
        cat > .env << EOF
# API Keys (replace with your actual keys)
OPENAI_API_KEY=your_openai_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
GOOGLE_API_KEY=your_google_key_here
TAVILY_API_KEY=your_tavily_key_here

# Redis Configuration
REDIS_URL=redis://redis:6379

# Environment
NODE_ENV=development
EOF
        print_warning "Created .env file with placeholder values. Please update with real API keys."
    else
        print_status "Environment file already exists"
    fi
}

# Build and start services
deploy_services() {
    print_status "Building and starting services..."
    
    # Build images
    docker-compose build --no-cache
    
    # Start services in background
    docker-compose up -d
    
    print_success "Services started"
}

# Wait for services to be ready
wait_for_services() {
    print_status "Waiting for services to be ready..."
    
    # Function to check if a service is ready
    check_service() {
        local url=$1
        local name=$2
        local max_attempts=30
        local attempt=1
        
        while [ $attempt -le $max_attempts ]; do
            if curl -sf "$url" > /dev/null 2>&1; then
                print_success "$name is ready"
                return 0
            fi
            
            echo -n "."
            sleep 2
            ((attempt++))
        done
        
        print_error "$name failed to start within timeout"
        return 1
    }
    
    # Check each service
    echo -n "Checking Redis..."
    sleep 5  # Give Redis a moment to start
    echo " (Redis doesn't have HTTP endpoint, assuming ready)"
    
    echo -n "Checking Backend..."
    check_service "http://localhost:8000/health" "Backend"
    
    echo -n "Checking Frontend..."
    check_service "http://localhost:3000" "Frontend"
    
    echo -n "Checking Monitoring..."
    check_service "http://localhost:8080/health" "Monitoring Dashboard"
    
    print_success "All services are ready!"
}

# Run comprehensive tests
run_tests() {
    print_status "Running comprehensive integration tests..."
    
    cd tests
    node integration-test.js
    test_exit_code=$?
    cd ..
    
    if [ $test_exit_code -eq 0 ]; then
        print_success "All tests passed!"
    else
        print_error "Some tests failed. Check the output above."
        return 1
    fi
}

# Display service information
show_service_info() {
    echo ""
    print_success "🎉 Enhanced Research Agent is now running!"
    echo ""
    echo "🌐 Service URLs:"
    echo "   Frontend:           http://localhost:3000"
    echo "   Backend API:        http://localhost:8000"
    echo "   Health Check:       http://localhost:8000/health"
    echo "   Metrics:            http://localhost:8000/metrics"
    echo "   Monitoring Dashboard: http://localhost:8080"
    echo ""
    echo "📊 Enhanced Features:"
    echo "   ✅ Redis Caching & Conversation Checkpoints"
    echo "   ✅ Multi-Provider LLM Gateway with Fallbacks"
    echo "   ✅ Intelligent Model Routing & Selection"
    echo "   ✅ Token Validation & Chunking"
    echo "   ✅ Safety Filters & Input Validation"
    echo "   ✅ Performance Metrics & Monitoring"
    echo "   ✅ Error Recovery & Conversation Management"
    echo "   ✅ Feature Flags & Dynamic Configuration"
    echo ""
    echo "🔧 Management Commands:"
    echo "   View logs:          docker-compose logs -f"
    echo "   Stop services:      docker-compose down"
    echo "   Restart services:   docker-compose restart"
    echo "   View containers:    docker-compose ps"
    echo ""
}

# Error handling
handle_error() {
    print_error "Deployment failed. Showing container logs..."
    docker-compose logs --tail=50
    echo ""
    print_error "To retry deployment:"
    echo "1. Fix any issues shown in the logs above"
    echo "2. Run: docker-compose down"
    echo "3. Run this script again"
    exit 1
}

# Main execution flow
main() {
    # Set error trap
    trap handle_error ERR
    
    # Run all steps
    check_prerequisites
    cleanup_existing
    create_env_file
    install_dependencies
    deploy_services
    wait_for_services
    run_tests
    show_service_info
    
    print_success "🎉 Enhanced Research Agent deployment completed successfully!"
}

# Handle script arguments
case "${1:-deploy}" in
    "deploy")
        main
        ;;
    "test")
        print_status "Running tests only..."
        cd tests && node integration-test.js
        ;;
    "stop")
        print_status "Stopping all services..."
        docker-compose down
        print_success "All services stopped"
        ;;
    "restart")
        print_status "Restarting all services..."
        docker-compose restart
        wait_for_services
        print_success "All services restarted"
        ;;
    "logs")
        docker-compose logs -f
        ;;
    "status")
        docker-compose ps
        ;;
    *)
        echo "Usage: $0 [deploy|test|stop|restart|logs|status]"
        echo ""
        echo "Commands:"
        echo "  deploy   - Deploy and test the enhanced system (default)"
        echo "  test     - Run integration tests only"
        echo "  stop     - Stop all services"
        echo "  restart  - Restart all services"
        echo "  logs     - Show service logs"
        echo "  status   - Show service status"
        exit 1
        ;;
esac