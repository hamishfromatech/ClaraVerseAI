import { useEffect, useState } from 'react';
import { ArrowRight, Check, Zap, Shield, Code, Brain, Globe, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui';

export const Home = () => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Hero Section */}
      <section className="relative overflow-hidden px-6 py-24 md:px-12 lg:px-24">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-gray-900/50 via-transparent to-transparent" />

        {/* Animated background elements */}
        <div className={`absolute top-1/4 left-1/4 w-96 h-96 bg-white/5 rounded-full blur-3xl transition-opacity duration-1000 ${mounted ? 'opacity-100' : 'opacity-0'}`} />
        <div className={`absolute bottom-1/4 right-1/4 w-64 h-64 bg-gray-600/10 rounded-full blur-3xl transition-opacity duration-1000 delay-300 ${mounted ? 'opacity-100' : 'opacity-0'}`} />

        <div className="relative max-w-7xl mx-auto">
          {/* Badge */}
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-gray-300 mb-8 transition-all duration-500 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            <Sparkles className="w-4 h-4 text-white" />
            <span>Now available — Version 2.0</span>
          </div>

          {/* Hero Content */}
          <div className={`max-w-4xl transition-all duration-700 delay-100 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight mb-6">
              <span className="bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
                AI Workspace
              </span>
              <br />
              <span className="text-white">Reimagined</span>
            </h1>

            <p className="text-xl md:text-2xl text-gray-400 mb-12 max-w-2xl leading-relaxed">
              A-Tech AI brings together powerful language models, visual design tools, and workflow automation in one elegant interface.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Link to="/chat">
                <Button className="h-14 px-8 bg-white text-black hover:bg-gray-100 text-base font-medium">
                  Get Started
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </Link>
              <Button className="h-14 px-8 bg-transparent border border-white/20 text-white hover:bg-white/5 text-base font-medium">
                Learn More
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className={`mt-20 grid grid-cols-2 md:grid-cols-4 gap-8 transition-all duration-700 delay-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
            <div className="text-center">
              <div className="text-4xl font-bold text-white mb-1">10M+</div>
              <div className="text-sm text-gray-500">Messages Processed</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-white mb-1">50+</div>
              <div className="text-sm text-gray-500">AI Models</div>
            </div>
            <div class="text-center">
              <div className="text-4xl font-bold text-white mb-1">99.9%</div>
              <div className="text-sm text-gray-500">Uptime</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-white mb-1">Zero</div>
              <div className="text-sm text-gray-500">Data Stored on Server</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="px-6 py-32 md:px-12 lg:px-24 bg-gradient-to-b from-black via-gray-900/50 to-black">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
              Built for the modern team
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Everything you need to collaborate, create, and automate with AI.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Feature Cards */}
            {[
              {
                icon: <Brain className="w-6 h-6" />,
                title: 'Multi-Model AI',
                description: 'Access GPT-4, Claude, Gemini, and 50+ more models from a single interface.',
              },
              {
                icon: <Shield className="w-6 h-6" />,
                title: 'Privacy First',
                description: 'Your conversations stay in your browser. Zero-knowledge architecture.',
              },
              {
                icon: <Code className="w-6 h-6" />,
                title: 'Code Execution',
                description: 'Run code in secure sandboxes with real-time output visualization.',
              },
              {
                icon: <Zap className="w-6 h-6" />,
                title: 'Lightning Fast',
                description: 'Built for speed with streaming responses and instant interactions.',
              },
              {
                icon: <Globe className="w-6 h-6" />,
                title: 'Web Search',
                description: 'Integrated web search powered by privacy-respecting engines.',
              },
              {
                icon: <Sparkles className="w-6 h-6" />,
                title: 'Visual Workflows',
                description: 'Drag-and-drop automation builder for complex AI workflows.',
              },
            ].map((feature, index) => (
              <div
                key={index}
                className="group p-8 rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 hover:bg-white/10 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center mb-6 group-hover:bg-white/20 transition-colors">
                  <div className="text-white">
                    {feature.icon}
                  </div>
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">{feature.title}</h3>
                <p className="text-gray-400 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities Section */}
      <section className="px-6 py-32 md:px-12 lg:px-24">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
                Capabilities that matter
              </h2>
              <p className="text-xl text-gray-400 mb-10 leading-relaxed">
                From simple chat to complex automation, A-Tech AI scales with your needs.
              </p>

              <div className="space-y-6">
                {[
                  'Interactive conversations with context awareness',
                  'Image generation and analysis with vision models',
                  'Document processing and summarization',
                  'Multi-agent collaboration for complex tasks',
                  'Custom workflow automation with visual builder',
                  'Real-time code execution and debugging',
                ].map((item, index) => (
                  <div key={index} className="flex items-start gap-4">
                    <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-gray-300">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="aspect-square rounded-3xl bg-gradient-to-br from-gray-800 to-gray-900 border border-white/10 p-8 flex items-center justify-center">
                <div className="text-center">
                  <Sparkles className="w-20 h-20 text-white/80 mx-auto mb-6" />
                  <div className="text-6xl font-bold text-white mb-2">A-Tech</div>
                  <div className="text-xl text-gray-400">AI Workspace</div>
                </div>
              </div>
              {/* Decorative elements */}
              <div className="absolute -top-4 -right-4 w-24 h-24 bg-white/10 rounded-full blur-2xl" />
              <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-gray-700/20 rounded-full blur-2xl" />
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="px-6 py-32 md:px-12 lg:px-24 bg-gradient-to-b from-black via-gray-900 to-gray-900">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-6xl font-bold text-white mb-6">
            Ready to get started?
          </h2>
          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
            Join thousands of teams already using A-Tech AI to power their workflows.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/chat">
              <Button className="h-14 px-10 bg-white text-black hover:bg-gray-100 text-lg font-semibold">
                Start Free
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <Button className="h-14 px-10 bg-transparent border border-white/20 text-white hover:bg-white/5 text-lg font-semibold">
              Contact Sales
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-12 md:px-12 lg:px-24 border-t border-white/10">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="text-white font-semibold text-lg">A-Tech AI</div>
            <div className="text-gray-500 text-sm">
              © 2024 A-Tech AI. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};