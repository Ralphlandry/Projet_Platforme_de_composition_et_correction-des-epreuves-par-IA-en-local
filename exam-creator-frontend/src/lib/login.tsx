import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();

    try {
      const res = await api.post("/auth/login", {
        email,
        password,
      });

      // 1. stocker token
      localStorage.setItem("token", res.data.access_token);

      // 2. redirect dashboard
      navigate("/dashboard");

    } catch (err) {
      console.log(err);
      alert("Login échoué");
    }
  };


  return (
    <form onSubmit={handleLogin}>
      <input onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input type="password" onChange={(e) => setPassword(e.target.value)} placeholder="password" />

      <button type="submit">Connecter</button>
    </form>
  );
}
