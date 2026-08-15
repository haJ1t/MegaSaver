// Committed alias seed: import name -> PyPI distribution name. Keys are
// case-sensitive import names — lookup happens BEFORE lowercasing.
export const PYPI_IMPORT_ALIASES: Readonly<Record<string, string>> = {
  cv2: "opencv-python",
  PIL: "pillow",
  sklearn: "scikit-learn",
  yaml: "pyyaml",
  bs4: "beautifulsoup4",
  dotenv: "python-dotenv",
  dateutil: "python-dateutil",
  jwt: "pyjwt",
  Crypto: "pycryptodome",
  magic: "python-magic",
  git: "gitpython",
  docx: "python-docx",
  fitz: "pymupdf",
  serial: "pyserial",
  websocket: "websocket-client",
  telegram: "python-telegram-bot",
};
