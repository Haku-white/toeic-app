import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import Login from './routes/Login'
import AuthCallback from './routes/AuthCallback'
import Home from './routes/Home'
import VocabReview from './routes/VocabReview'
import VocabTagList from './routes/VocabTagList'
import GrammarCategories from './routes/GrammarCategories'
import GrammarDrill from './routes/GrammarDrill'
import WeakPoints from './routes/WeakPoints'
import MixedDrill from './routes/MixedDrill'
import { requireSession } from './lib/authLoader'

const queryClient = new QueryClient()

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/auth/callback', element: <AuthCallback /> },
  { path: '/', element: <Home />, loader: requireSession },
  { path: '/vocab/review', element: <VocabReview />, loader: requireSession },
  { path: '/vocab/review/:tagCode', element: <VocabReview />, loader: requireSession },
  { path: '/vocab/tags', element: <VocabTagList />, loader: requireSession },
  { path: '/grammar', element: <GrammarCategories />, loader: requireSession },
  { path: '/grammar/:categoryCode', element: <GrammarDrill />, loader: requireSession },
  { path: '/weak-points', element: <WeakPoints />, loader: requireSession },
  { path: '/mixed-drill', element: <MixedDrill />, loader: requireSession },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
