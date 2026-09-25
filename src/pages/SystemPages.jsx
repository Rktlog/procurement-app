import { Link } from 'react-router-dom';
import { useAuth } from '../app/AuthContext';

export function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper">
      <div className="flex items-center gap-3 text-sm text-slate-600" role="status">
        <span className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-blue-600 animate-spin" />
        Checking your session
      </div>
    </div>
  );
}

export function PermissionsErrorScreen() {
  const { retryPermissions, signOut } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-6">
      <div className="max-w-md">
        <h1 className="page-title text-[2rem] text-ink">Couldn't load your access</h1>
        <p className="mt-2 text-sm text-slate-600">
          The permissions check didn't return any modules for your account. It may be a temporary
          connection issue. If it keeps happening, ask an admin to check your module access.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={retryPermissions}
            className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold cursor-pointer"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={signOut}
            className="h-10 px-4 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-ink hover:bg-slate-50 cursor-pointer"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export function NoAccessPage() {
  return (
    <div className="max-w-lg py-10">
      <h1 className="page-title text-[2rem] text-ink">You don't have access to this page</h1>
      <p className="mt-2 text-sm text-slate-600">
        This module isn't assigned to your account. An admin can add it from User access.
      </p>
      <Link to="/" className="mt-6 inline-block text-sm font-semibold text-blue-700 hover:underline">
        Go to home
      </Link>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="max-w-lg py-10">
      <h1 className="page-title text-[2rem] text-ink">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600">
        This address doesn't match any page. It may have moved when the app was reorganised.
      </p>
      <Link to="/" className="mt-6 inline-block text-sm font-semibold text-blue-700 hover:underline">
        Go to home
      </Link>
    </div>
  );
}
