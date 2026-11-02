// VPA shape validation, kept in its own dependency-free module so the
// Settings form can import it in the browser. upi-qr.ts pulls in the
// `qrcode` package, which has no business in a client bundle.

// A Virtual Payment Address: `handle@psp`. The handle is the account alias
// (a phone number, or a name the PSP issued) and the part after "@" is the
// PSP that can resolve it — "8870714655@ybl", not "8870714655". NPCI allows
// letters, digits, dot, hyphen and underscore in the handle; the PSP suffix
// is alphabetic. Deliberately permissive about WHICH psp, since that list
// grows, but strict about the shape, because that is the part that silently
// breaks a QR.
const VPA_PATTERN = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

export function isValidVpa(vpa: string): boolean {
  return VPA_PATTERN.test(vpa.trim());
}
