import { api } from "./api";

export const screenShareApi = {
  createSession: async () => {
    const res = await api.post("/screen-share/create-session");
    return res.data;
  },
  joinSession: async (sessionId) => {
    const res = await api.post("/screen-share/join-session", { sessionId });
    return res.data;
  },
  getSession: async (sessionId) => {
    const res = await api.get(`/screen-share/session/${sessionId}`);
    return res.data;
  },
  endSession: async (sessionId) => {
    const res = await api.delete(`/screen-share/session/${sessionId}`);
    return res.data;
  },
  listMySessions: async () => {
    const res = await api.get("/screen-share/my-sessions");
    return res.data;
  },
};
