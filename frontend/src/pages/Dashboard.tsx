import { MessageSquare, Bot, Settings, Shield } from 'lucide-react';
import { AppCard } from '@/components/dashboard';
import { UserMenu, Snowfall } from '@/components/ui';
import { useIsMobile } from '@/hooks';
import logoIcon from '/logo.png';

const apps = [
  {
    id: 'chat',
    icon: MessageSquare,
    title: 'Chat',
    description: 'Talk to Kaylah AI assistant',
    href: '/chat',
  },
  {
    id: 'agents',
    icon: Bot,
    title: 'Agents',
    description: 'Build AI assistants',
    href: '/agents',
  },
  {
    id: 'admin',
    icon: Shield,
    title: 'Admin',
    description: 'Manage users and system',
    href: '/admin',
  },
  {
    id: 'settings',
    icon: Settings,
    title: 'Settings',
    description: 'Configure your workspace',
    href: '/settings',
  },
];

export default function Dashboard() {
  const isMobile = useIsMobile();

  // =============================================================================
  // MOBILE LAYOUT - Phone-style app grid
  // =============================================================================
  if (isMobile) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--color-background)',
          display: 'flex',
          flexDirection: 'column',
          padding: '0',
          position: 'relative',
        }}
      >
        <Snowfall />
        {/* Mobile Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            paddingTop: 'max(16px, env(safe-area-inset-top))',
          }}
        >
          <a href="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
            <img
              src={logoIcon}
              alt="Clara logo"
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
              }}
            />
          </a>
          <UserMenu />
        </div>

        {/* Mobile Content */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 20px 40px',
          }}
        >
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <h1
              style={{
                fontSize: '1.75rem',
                fontWeight: 'var(--font-weight-bold)',
                marginBottom: '8px',
                background: 'var(--gradient-text)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Welcome To Your AI Workspace
            </h1>
            <p
              style={{
                fontSize: '14px',
                color: 'var(--color-text-secondary)',
              }}
            >
              What would you like to do today?
            </p>
          </div>

          {/* Phone-style App Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px 4px',
              width: '100%',
              maxWidth: '320px',
            }}
          >
            {apps.map(app => (
              <AppCard
                key={app.id}
                icon={app.icon}
                title={app.title}
                description={app.description}
                href={app.href}
                compact
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // =============================================================================
  // DESKTOP LAYOUT - Original unchanged
  // =============================================================================
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--color-background)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-8) var(--space-6)',
        position: 'relative',
      }}
    >
      <Snowfall />

      {/* Logo - Top Left */}
      <div
        style={{
          position: 'absolute',
          top: 'var(--space-6)',
          left: 'var(--space-6)',
        }}
      >
        <a href="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
          <img
            src={logoIcon}
            alt="Clara logo"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
            }}
          />
        </a>
      </div>

      {/* User Menu - Top Right */}
      <div
        style={{
          position: 'absolute',
          top: 'var(--space-6)',
          right: 'var(--space-6)',
        }}
      >
        <UserMenu />
      </div>

      <div style={{ width: '100%', maxWidth: '1100px' }}>
        {/* Header */}
        <div
          className="dashboard-header"
          style={{ textAlign: 'center', marginBottom: 'var(--space-10)' }}
        >
          <h1
            style={{
              fontSize: 'clamp(2.5rem, 5vw, 4rem)',
              fontWeight: 'var(--font-weight-bold)',
              marginBottom: 'var(--space-3)',
              background: 'var(--gradient-text)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Your AI Workspace
          </h1>
          <p
            style={{
              fontSize: 'var(--text-base)',
              color: 'var(--color-text-secondary)',
            }}
          >
            What would you like to do today?
          </p>
        </div>

        {/* Apps Grid */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '24px',
            maxWidth: '900px',
            margin: '0 auto',
          }}
          className="dashboard-grid"
        >
          {apps.map(app => (
            <div key={app.id} style={{ flex: '0 1 280px', minWidth: '220px' }}>
              <AppCard
                icon={app.icon}
                title={app.title}
                description={app.description}
                href={app.href}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
