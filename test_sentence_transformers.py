from sentence_transformers import SentenceTransformer, util


def main() -> None:
    model_name = "all-MiniLM-L6-v2"
    print(f"Chargement du modele {model_name}...")
    model = SentenceTransformer(model_name)

    phrases = [
        "Explique ce qu'est une fonction en Python.",
        "Une fonction est un bloc de code reutilisable qui prend des entrees et retourne un resultat.",
        "Le HTML est un langage de balisage pour creer des pages web.",
    ]

    print("Encodage des phrases...")
    embeddings = model.encode(phrases, convert_to_tensor=True, normalize_embeddings=True)

    query = "C'est quoi une fonction en programmation ?"
    print(f"Encodage de la question de test : {query}")
    query_emb = model.encode(query, convert_to_tensor=True, normalize_embeddings=True)

    print("Calcul de la similarite cosinus...")
    scores = util.cos_sim(query_emb, embeddings)

    for i, phrase in enumerate(phrases):
        score = float(scores[0][i].item())
        print(f"Phrase {i+1}: {phrase}")
        print(f"  Similarite avec la question : {score:.4f}")

    print("\nTest termine.")


if __name__ == "__main__":
    main()
