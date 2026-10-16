import { loadEndpoints } from './lib/endpoints.js'
import { initTheme } from './lib/theme.js'
import './index.css'

initTheme()

// Service URLs (src/lib/endpoints.js) must be known before the app modules evaluate —
// some build module-level constants from them — so the app is imported only once the
// runtime config has loaded (bounded by a timeout, prod defaults on failure).
async function boot() {
  await loadEndpoints()
  const [
    { default: React },
    { default: ReactDOM },
    { BrowserRouter },
    { default: App },
    { AuthProvider },
    { CardZoomProvider },
    { LangProvider },
    { default: ErrorBoundary },
  ] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('react-router-dom'),
    import('./App.jsx'),
    import('./auth/AuthProvider.jsx'),
    import('./components/CardZoom.jsx'),
    import('./lib/i18n/i18n.jsx'),
    import('./components/ErrorBoundary.jsx'),
  ])

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <LangProvider>
            <AuthProvider>
              <CardZoomProvider>
                <App />
              </CardZoomProvider>
            </AuthProvider>
          </LangProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </React.StrictMode>
  )
}

boot()
