export const getSourceLabel = (source) => {
  if (source === "saved-session") return "Saved Session";
  return "Local Cluster Engine";
};

export const buildAccessCodeEmailMessage = ({ code }) =>
  [
    "Your KUCCPS cluster calculation is ready.",
    "",
    `Access code: ${code}`,
    "",
    "Use this code on the home page to open your saved cluster points and continue course selection.",
  ].join("\n");

