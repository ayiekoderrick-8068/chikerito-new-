import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    const token = localStorage.getItem("chikerito_token");
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const { user } = await api.me();
      setUser(user);
    } catch (e) {
      localStorage.removeItem("chikerito_token");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    function handleUnauthorized() {
      setUser(null);
    }
    window.addEventListener("chikerito:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("chikerito:unauthorized", handleUnauthorized);
  }, []);

  async function login(email, password) {
    const { token, user } = await api.login({ email, password });
    localStorage.setItem("chikerito_token", token);
    setUser(user);
  }

  async function register(payload) {
    const { token, user } = await api.register(payload);
    localStorage.setItem("chikerito_token", token);
    setUser(user);
  }

  function logout() {
    localStorage.removeItem("chikerito_token");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
