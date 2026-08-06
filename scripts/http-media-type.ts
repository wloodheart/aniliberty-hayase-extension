const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+"
const QUOTED_STRING = '"(?:[\\t !#-\\[\\]-~]|\\\\[\\t -~])*"'
const JSON_MEDIA_TYPE = new RegExp(
  `^[\\t ]*application/json(?:[\\t ]*;[\\t ]*${TOKEN}[\\t ]*=[\\t ]*(?:${TOKEN}|${QUOTED_STRING}))*[\\t ]*$`,
  "i",
)

export function isJsonMediaType(value: string): boolean {
  return JSON_MEDIA_TYPE.test(value)
}
