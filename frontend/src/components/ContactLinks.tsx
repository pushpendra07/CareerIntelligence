/** Ways to reach a contact: email, phone (call) and WhatsApp, LinkedIn. */
export function ContactLinks({ email, phone, linkedin, className = "text-xs" }: {
  email?: string | null; phone?: string | null; linkedin?: string | null; className?: string;
}) {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return (
    <div className={`space-y-0.5 ${className}`}>
      {email && <a className="link block break-all" href={`mailto:${email}`}>{email}</a>}
      {phone && (
        <div>
          <a className="link" href={`tel:${phone.replace(/\s/g, "")}`}>{phone}</a>
          {digits.length >= 10 && <> · <a className="link" href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer">WhatsApp</a></>}
        </div>
      )}
      {linkedin && <a className="link block" href={linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a>}
    </div>
  );
}
