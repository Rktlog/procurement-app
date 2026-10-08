import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErrorMsg(error.message);
    setLoading(false);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr] bg-paper">
      <div className="bg-rail text-white px-8 py-10 lg:px-14 lg:py-14 flex flex-col justify-between">
        <span className="font-display font-extrabold [font-stretch:68%] text-[3.2rem] sm:text-[4.5rem] lg:text-[6rem] leading-[0.88] tracking-tight">
          Rocket
          <br />
          Logistics
        </span>
        <p className="mt-8 max-w-[34ch] text-rail-text text-[0.95rem]">
          Purchasing, fulfillment and invoicing for the Rocket Logistics warehouse.
        </p>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <form onSubmit={handleLogin} className="w-full max-w-[22rem]">
          <h1 className="page-title text-[2rem] text-ink">Sign in</h1>
          <p className="mt-1 mb-7 text-sm text-slate-600">Use your work email and password.</p>

          {errorMsg && (
            <div role="alert" className="mb-5 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
              {errorMsg}
            </div>
          )}

          <label className="block text-sm font-semibold text-ink mb-1.5" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full h-11 rounded-lg border border-slate-300 bg-white px-3 text-[0.95rem] focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
          />

          <label className="block text-sm font-semibold text-ink mt-4 mb-1.5" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full h-11 rounded-lg border border-slate-300 bg-white px-3 text-[0.95rem] focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
          />

          <button
            type="submit"
            disabled={loading}
            className="mt-7 w-full h-11 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[0.95rem] disabled:opacity-60 cursor-pointer"
          >
            {loading ? 'Signing in' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}