/**
 * Comprehensive Integration Testing Script
 * Tests all enhanced services and Docker infrastructure
 */

const fetch = require('node-fetch');
const { performance } = require('perf_hooks');

class IntegrationTester {
  constructor() {
    this.results = {
      tests: [],
      passed: 0,
      failed: 0,
      duration: 0
    };
    this.baseUrls = {
      backend: 'http://localhost:8000',
      frontend: 'http://localhost:3000',
      monitoring: 'http://localhost:8080'
    };
  }

  async runTest(name, testFn) {
    const startTime = performance.now();
    console.log(`🧪 Running: ${name}`);
    
    try {
      await testFn();
      const duration = Math.round(performance.now() - startTime);
      console.log(`✅ PASSED: ${name} (${duration}ms)`);
      
      this.results.tests.push({ name, status: 'PASSED', duration });
      this.results.passed++;
    } catch (error) {
      const duration = Math.round(performance.now() - startTime);
      console.log(`❌ FAILED: ${name} (${duration}ms)`);
      console.log(`   Error: ${error.message}`);
      
      this.results.tests.push({ name, status: 'FAILED', duration, error: error.message });
      this.results.failed++;
    }
  }

  async testServiceHealth(serviceName, url) {
    const response = await fetch(`${url}/health`);
    if (!response.ok) {
      throw new Error(`${serviceName} health check failed: ${response.status}`);
    }
    const health = await response.json();
    if (health.status !== 'healthy') {
      throw new Error(`${serviceName} reports unhealthy status: ${health.status}`);
    }
  }

  async testBackendServices() {
    // Test health endpoint
    await this.runTest('Backend Health Check', async () => {
      await this.testServiceHealth('Backend', this.baseUrls.backend);
    });

    // Test metrics endpoint
    await this.runTest('Backend Metrics Endpoint', async () => {
      const response = await fetch(`${this.baseUrls.backend}/metrics`);
      if (!response.ok) {
        throw new Error(`Metrics endpoint failed: ${response.status}`);
      }
    });

    // Test agent execution endpoint
    await this.runTest('Agent Execution API', async () => {
      const testPayload = {
        input: {
          messages: [{ type: 'human', content: 'Test message' }],
          resources: []
        },
        config: { thread_id: 'test-thread-' + Date.now() }
      };

      const response = await fetch(`${this.baseUrls.backend}/agent/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload)
      });

      if (!response.ok) {
        throw new Error(`Agent execution failed: ${response.status}`);
      }
    });
  }

  async testFrontendServices() {
    await this.runTest('Frontend Health Check', async () => {
      const response = await fetch(`${this.baseUrls.frontend}`);
      if (!response.ok) {
        throw new Error(`Frontend not accessible: ${response.status}`);
      }
    });

    await this.runTest('Frontend API Routes', async () => {
      const response = await fetch(`${this.baseUrls.frontend}/api/copilotkit`);
      // This might return different statuses, but should be reachable
      if (response.status >= 500) {
        throw new Error(`Frontend API error: ${response.status}`);
      }
    });
  }

  async testMonitoringDashboard() {
    await this.runTest('Monitoring Dashboard', async () => {
      const response = await fetch(`${this.baseUrls.monitoring}/dashboard.html`);
      if (!response.ok) {
        throw new Error(`Monitoring dashboard not accessible: ${response.status}`);
      }
      const content = await response.text();
      if (!content.includes('Research Agent Monitoring')) {
        throw new Error('Dashboard content not properly loaded');
      }
    });

    await this.runTest('Monitoring Health Check', async () => {
      const response = await fetch(`${this.baseUrls.monitoring}/health`);
      if (!response.ok) {
        throw new Error(`Monitoring health check failed: ${response.status}`);
      }
    });
  }

  async testRedisConnectivity() {
    await this.runTest('Redis Connectivity Test', async () => {
      // Test Redis through backend health check which should verify Redis
      const response = await fetch(`${this.baseUrls.backend}/health`);
      if (!response.ok) {
        throw new Error('Cannot verify Redis connectivity');
      }
      
      const health = await response.json();
      if (health.services && health.services.redis !== 'connected') {
        throw new Error('Redis not connected according to health check');
      }
    });
  }

  async testPerformanceBenchmark() {
    const iterations = 10;
    const responseTimes = [];

    await this.runTest(`Performance Benchmark (${iterations} requests)`, async () => {
      for (let i = 0; i < iterations; i++) {
        const startTime = performance.now();
        
        const response = await fetch(`${this.baseUrls.backend}/health`);
        if (!response.ok) {
          throw new Error(`Request ${i + 1} failed`);
        }
        
        const endTime = performance.now();
        responseTimes.push(endTime - startTime);
      }

      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);
      const minResponseTime = Math.min(...responseTimes);

      console.log(`   📊 Performance Results:`);
      console.log(`      Average: ${avgResponseTime.toFixed(2)}ms`);
      console.log(`      Min: ${minResponseTime.toFixed(2)}ms`);
      console.log(`      Max: ${maxResponseTime.toFixed(2)}ms`);

      // Expect performance improvement - average should be under 500ms
      if (avgResponseTime > 500) {
        throw new Error(`Average response time too high: ${avgResponseTime.toFixed(2)}ms`);
      }
    });
  }

  async testServiceOrchestration() {
    await this.runTest('Service Orchestration Test', async () => {
      // Test that all services are running and accessible
      const services = [
        { name: 'Backend', url: this.baseUrls.backend },
        { name: 'Frontend', url: this.baseUrls.frontend },
        { name: 'Monitoring', url: this.baseUrls.monitoring }
      ];

      for (const service of services) {
        const response = await fetch(service.url);
        if (!response.ok && response.status !== 404) { // 404 might be OK for some endpoints
          throw new Error(`${service.name} not responding: ${response.status}`);
        }
      }
    });
  }

  async waitForServices(maxWait = 60000) {
    console.log('⏳ Waiting for services to be ready...');
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      try {
        await fetch(`${this.baseUrls.backend}/health`);
        console.log('✅ Services are ready!');
        return;
      } catch (error) {
        console.log('⏳ Still waiting for services...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    throw new Error('Services did not become ready within timeout');
  }

  async runAllTests() {
    const startTime = performance.now();
    
    console.log('🚀 Starting Enhanced Research Agent Integration Tests');
    console.log('==================================================');

    try {
      // Wait for services to be ready
      await this.waitForServices();

      // Run all test suites
      await this.testServiceOrchestration();
      await this.testBackendServices();
      await this.testFrontendServices();
      await this.testMonitoringDashboard();
      await this.testRedisConnectivity();
      await this.testPerformanceBenchmark();

    } catch (error) {
      console.log(`💥 Test setup failed: ${error.message}`);
      this.results.failed++;
    }

    this.results.duration = Math.round(performance.now() - startTime);
    this.printResults();
  }

  printResults() {
    console.log('\n🏁 Test Results Summary');
    console.log('=======================');
    console.log(`Total Tests: ${this.results.tests.length}`);
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`⏱️  Total Duration: ${this.results.duration}ms`);
    console.log(`🎯 Success Rate: ${((this.results.passed / this.results.tests.length) * 100).toFixed(1)}%`);

    if (this.results.failed === 0) {
      console.log('\n🎉 ALL TESTS PASSED! The enhanced system is working perfectly.');
    } else {
      console.log('\n⚠️  Some tests failed. Check the logs above for details.');
    }

    // Print detailed results
    console.log('\n📝 Detailed Results:');
    this.results.tests.forEach(test => {
      const status = test.status === 'PASSED' ? '✅' : '❌';
      console.log(`${status} ${test.name}: ${test.duration}ms`);
      if (test.error) {
        console.log(`    Error: ${test.error}`);
      }
    });
  }
}

// Run the tests
if (require.main === module) {
  const tester = new IntegrationTester();
  tester.runAllTests().catch(console.error);
}

module.exports = IntegrationTester;