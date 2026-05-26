import { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();

    try {
      const res = await axios.post(
        "http://192.168.1.123:8000/api/auth/login",
        {
          email,
          password,
        }
      );

      // 🔐 sauvegarde token
      localStorage.setItem("token", res.data.access_token);

      // 🚀 REDIRECTION IMPORTANTE
      navigate("/dashboard");

    } catch (error) {
      console.log(error);
      alert("Login échoué");
    }
  };

  return (
    <form onSubmit={handleLogin}>
      <input onChange={(e) => setEmail(e.target.value)} />
      <input type="password" onChange={(e) => setPassword(e.target.value)} />

      <button type="submit">Connecter</button>
    </form>
  );
}
