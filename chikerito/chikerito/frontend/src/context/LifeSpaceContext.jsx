import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../api";
import { useAuth } from "./AuthContext.jsx";

const LifeSpaceContext = createContext(null);

export function LifeSpaceProvider({ children }) {
  const { user } = useAuth();
  const [lifeSpaces, setLifeSpaces] = useState([]);
  const [currentId, setCurrentId] = useState(localStorage.getItem("chikerito_current_ls") || null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { lifeSpaces } = await api.listLifeSpaces();
      setLifeSpaces(lifeSpaces);
      if (!currentId && lifeSpaces.length) {
        setCurrentId(lifeSpaces[0].id);
        localStorage.setItem("chikerito_current_ls", lifeSpaces[0].id);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function selectLifeSpace(id) {
    setCurrentId(id);
    localStorage.setItem("chikerito_current_ls", id);
  }

  const current = lifeSpaces.find((l) => l.id === currentId) || null;

  return (
    <LifeSpaceContext.Provider value={{ lifeSpaces, current, currentId, selectLifeSpace, refresh, loading }}>
      {children}
    </LifeSpaceContext.Provider>
  );
}

export function useLifeSpace() {
  return useContext(LifeSpaceContext);
}
