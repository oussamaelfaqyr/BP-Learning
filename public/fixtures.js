window.BP_FIXTURES = Object.freeze({
  learner: { initials: "NA", displayName: "Nadia A. · profil fictif", context: "Équipe officinale · Casablanca" },
  course: {
    eyebrow: "Communication en pharmacie",
    title: "Mieux accueillir et expliquer en pharmacie",
    description:
      "Entraîne-toi à demander la langue préférée, expliquer une étape à la fois et vérifier la compréhension avec respect.",
    duration: "15 minutes",
    level: "Fondamentaux",
  },
  preparation: [
    {
      id: "langue",
      title: "Demander la langue préférée",
      body: "Proposer un français simple ou une explication orale en darija, sans supposer la préférence de la personne.",
    },
    {
      id: "expliquer",
      title: "Expliquer simplement",
      body: "Présenter une étape à la fois, éviter le jargon et utiliser un exemple concret du quotidien.",
    },
    {
      id: "comprendre",
      title: "Vérifier la compréhension",
      body: "Inviter la personne à reformuler, accueillir ses questions et noter clairement la prochaine étape.",
    },
  ],
  scenario: {
    customer: "Cliente fictive · Casablanca",
    context: "Une cliente souhaite comprendre des consignes générales affichées dans l’espace conseil. Elle lit le français, mais préfère parfois une explication orale en darija.",
    goal: "Demande sa préférence, explique par étapes et vérifie ce qu’elle a compris, sans formuler de conseil clinique.",
  },
  dialogue: [
    {
      speaker: "customer",
      text: "Je lis le français, mais je comprends mieux certaines explications en darija. Est-ce possible ?",
      choices: [
        "Bien sûr. Préférez-vous que nous commencions en français simple ou par une explication orale en darija ?",
        "Tout est déjà écrit en français sur l’affiche.",
        "Je vais choisir la langue pour aller plus vite.",
      ],
      best: 0,
      feedback: "La question laisse la personne choisir la langue qui lui convient.",
      choiceFeedback: [
        "Tu proposes un choix réel et tu laisses la personne décider : c’est la base du respect linguistique.",
        "Cette réponse ignore la demande et peut mettre la personne en difficulté si elle lit difficilement le français.",
        "Choisir à sa place lui retire la maîtrise de sa compréhension, même avec de bonnes intentions.",
      ],
      principleId: "preference",
    },
    {
      speaker: "customer",
      text: "Commençons en français simple. Je n’ai pas bien compris les trois étapes indiquées.",
      choices: [
        "D’accord. Regardons d’abord la première étape, puis vous me direz comment vous la comprenez.",
        "Je vais relire les trois étapes plus lentement, sans changer les mots.",
        "Ce document est pourtant très clair pour la plupart des personnes.",
      ],
      best: 0,
      feedback: "Une seule étape réduit la charge et rend la compréhension observable.",
      choiceFeedback: [
        "Une seule étape à la fois réduit la charge et te permet de vérifier la compréhension.",
        "Ralentir sans simplifier garde toutes les étapes en tête : la charge reste élevée.",
        "Comparer la personne aux autres peut la faire se sentir jugée.",
      ],
      principleId: "structure",
    },
    {
      speaker: "customer",
      text: "J’ai compris la première étape. Je dois aussi l’expliquer à ma mère à la maison.",
      choices: [
        "Je peux vous remettre un résumé très court. Pour toute question de santé précise, adressez-vous à un pharmacien.",
        "Mémorisez simplement tout ce que je viens de dire.",
        "Je ne peux rien faire si elle n’est pas présente.",
      ],
      best: 0,
      feedback: "Le résumé soutient la transmission et la limite professionnelle reste claire.",
      choiceFeedback: [
        "Un résumé soutient la transmission, et tu rappelles clairement la limite professionnelle.",
        "Demander de tout mémoriser ne laisse aucune trace et n’aide pas la transmission.",
        "Cette réponse ferme la porte alors qu’un résumé resterait utile, avec un renvoi au pharmacien.",
      ],
      principleId: "verification",
    },
  ],
  learningModules: [
    {
      id: "preference",
      title: "Préférence linguistique",
      label: "Accueil",
      description: "Demande une préférence sans déduire la maîtrise ou le niveau de lecture.",
      question: "Quelle question laisse réellement le choix ?",
      answers: ["Préférez-vous le français simple ou une explication orale en darija ?", "Vous parlez sûrement darija, n’est-ce pas ?", "Vous savez lire le français ?"],
      correct: 0,
    },
    {
      id: "structure",
      title: "Structurer l’explication",
      label: "Clarté",
      description: "Découpe l’information et donne un repère visible pour chaque étape.",
      question: "Quelle séquence aide le mieux à suivre ?",
      answers: ["Une étape · reformulation · étape suivante", "Tout le contenu · question à la fin", "Jargon · répétition · conclusion"],
      correct: 0,
    },
    {
      id: "verification",
      title: "Vérifier sans juger",
      label: "Compréhension",
      description: "Utilise la reformulation pour vérifier l’explication, pas pour tester la personne.",
      question: "Quelle formulation respecte la personne ?",
      answers: ["Pour vérifier si j’ai été clair, comment résumeriez-vous la première étape ?", "Répétez exactement ce que je viens de dire.", "Vous avez compris, oui ou non ?"],
      correct: 0,
    },
  ],
});
