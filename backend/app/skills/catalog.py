"""Skill and domain taxonomy shared by the CV parser, the JD parser and the matching engine.

Each skill has one canonical name, aliases used for detection, a category, an optional
`parent` (a more general skill it implies: "Magento 2" -> "Magento") and `related` skills
(adjacent experience that partially transfers: "MySQL" ~ "MariaDB").

Detection is deterministic: aliases are matched on word boundaries, longest alias first,
and a matched span is consumed so "Adobe Commerce Cloud" does not also count as
"Adobe Commerce". Short or common-word aliases ("REST", "LESS", "React") are matched
case-sensitively.

To add a skill, add one `S(...)` line. Bump CATALOG_VERSION when matching semantics change,
because scores record the catalog version they were computed with.
"""

import re
from dataclasses import dataclass, field
from functools import lru_cache

CATALOG_VERSION = "skills/1"


@dataclass(frozen=True)
class Skill:
    name: str
    category: str
    aliases: tuple[str, ...] = ()
    case_sensitive: tuple[str, ...] = ()
    parent: str | None = None
    related: tuple[str, ...] = ()


def S(  # noqa: N802 - short constructor keeps the table readable
    name: str,
    category: str,
    aliases: tuple[str, ...] | list[str] = (),
    *,
    cs: tuple[str, ...] | list[str] = (),
    parent: str | None = None,
    related: tuple[str, ...] | list[str] = (),
) -> Skill:
    return Skill(name, category, tuple(aliases), tuple(cs), parent, tuple(related))


SKILLS: tuple[Skill, ...] = (
    # Languages
    S("PHP", "language", ["php", "php 7", "php 8", "php7", "php8"]),
    S("Python", "language", ["python", "python3"]),
    S("JavaScript", "language", ["javascript", "js", "es6", "ecmascript"], related=["TypeScript"]),
    S("TypeScript", "language", ["typescript"], related=["JavaScript"]),
    S("Java", "language", cs=["Java", "JAVA", "Core Java"], related=["Kotlin"]),
    S("Kotlin", "language", ["kotlin"], related=["Java"]),
    S("C#", "language", ["c#", "csharp"], related=[".NET"]),
    S("Go", "language", ["golang"]),
    S("Ruby", "language", cs=["Ruby"]),
    S(
        "Node.js",
        "framework",
        ["node.js", "nodejs", "node js"],
        cs=["Node"],
        related=["JavaScript"],
    ),
    S("SQL", "database", cs=["SQL"]),
    # PHP ecosystem
    S("Magento", "platform", ["magento", "magento commerce"], related=["Adobe Commerce"]),
    S("Magento 2", "platform", ["magento 2", "magento2", "magento 2.x", "m2"], parent="Magento"),
    S("Magento 1", "platform", ["magento 1", "magento1", "magento 1.x", "m1"], parent="Magento"),
    S(
        "Magento Open Source",
        "platform",
        ["magento open source", "magento community"],
        parent="Magento 2",
    ),
    S(
        "Adobe Commerce",
        "platform",
        [
            "adobe commerce",
            "magento enterprise",
            "adobe commerce on-premise",
            "adobe commerce on premise",
        ],
        parent="Magento 2",
        related=["Magento"],
    ),
    S(
        "Adobe Commerce Cloud",
        "platform",
        ["adobe commerce cloud", "magento cloud", "magento commerce cloud"],
        parent="Adobe Commerce",
    ),
    S("Hyvä", "frontend", ["hyva", "hyvä", "hyva themes"], parent="Magento 2"),
    S("PWA Studio", "frontend", ["pwa studio", "venia"], parent="Magento 2", related=["PWA"]),
    S(
        "Magento MSI",
        "platform",
        ["msi", "multi-source inventory", "multi source inventory"],
        parent="Magento 2",
    ),
    S("Laravel", "framework", ["laravel"], related=["Symfony", "PHP"]),
    S("Symfony", "framework", ["symfony"], related=["Laravel"]),
    S("CodeIgniter", "framework", ["codeigniter"], related=["Laravel"]),
    S("Zend Framework", "framework", ["zend", "zend framework", "laminas"]),
    S("WordPress", "platform", ["wordpress"], related=["WooCommerce"]),
    S("WooCommerce", "platform", ["woocommerce"], related=["Magento"]),
    S("Shopify", "platform", ["shopify", "shopify plus", "liquid"], related=["Magento"]),
    S("BigCommerce", "platform", ["bigcommerce"], related=["Magento"]),
    S(
        "Salesforce Commerce Cloud",
        "platform",
        ["salesforce commerce cloud", "sfcc", "demandware"],
        related=["Magento"],
    ),
    S("SAP Commerce", "platform", ["sap commerce", "hybris", "sap hybris"], related=["Magento"]),
    S("commercetools", "platform", ["commercetools"], related=["Magento"]),
    S("PrestaShop", "platform", ["prestashop"], related=["Magento"]),
    S("OpenCart", "platform", ["opencart"], related=["Magento"]),
    S("Composer", "tool", cs=["Composer"]),
    S("PHPUnit", "testing", ["phpunit"]),
    # Frontend
    S(
        "React",
        "frontend",
        ["react.js", "reactjs", "react js"],
        cs=["React"],
        related=["Next.js", "Vue.js"],
    ),
    S("Next.js", "frontend", ["next.js", "nextjs"], parent="React"),
    S("Vue.js", "frontend", ["vue.js", "vuejs", "vue"], related=["React"]),
    S("Angular", "frontend", ["angular", "angularjs"], related=["React"]),
    S("jQuery", "frontend", ["jquery"]),
    S("KnockoutJS", "frontend", ["knockoutjs", "knockout.js", "knockout js"]),
    S("RequireJS", "frontend", ["requirejs"]),
    S("HTML", "frontend", ["html", "html5"]),
    S("CSS", "frontend", cs=["CSS", "CSS3"]),
    S("LESS", "frontend", cs=["LESS"], related=["SCSS"]),
    S("SCSS", "frontend", ["scss", "sass"], related=["LESS"]),
    S("Tailwind CSS", "frontend", ["tailwind", "tailwindcss", "tailwind css"]),
    S("PWA", "frontend", cs=["PWA"], aliases=["progressive web app", "progressive web apps"]),
    # Python / other backends
    S("FastAPI", "framework", ["fastapi"], related=["Flask", "Django"]),
    S("Django", "framework", ["django"], related=["FastAPI", "Flask"]),
    S("Flask", "framework", ["flask"], related=["FastAPI", "Django"]),
    S(
        "Spring Boot",
        "framework",
        ["spring boot", "springboot", "spring framework"],
        related=["Java"],
    ),
    S(".NET", "framework", [".net", "dotnet", "asp.net", ".net core"], related=["C#"]),
    S("Ruby on Rails", "framework", ["ruby on rails", "rails"]),
    S("Express.js", "framework", ["express.js", "expressjs"], related=["Node.js"]),
    # Databases
    S("MySQL", "database", ["mysql"], related=["MariaDB", "PostgreSQL"]),
    S("MariaDB", "database", ["mariadb"], related=["MySQL"]),
    S("PostgreSQL", "database", ["postgresql", "postgres"], related=["MySQL"]),
    S("MongoDB", "database", ["mongodb", "mongo"]),
    S("SQL Server", "database", ["sql server", "mssql"], related=["MySQL"]),
    S("Oracle Database", "database", ["oracle database", "oracle db", "pl/sql"]),
    S("Redis", "cache", ["redis"]),
    S("Varnish", "cache", ["varnish"]),
    S("Memcached", "cache", ["memcached"], related=["Redis"]),
    S("Elasticsearch", "search", ["elasticsearch", "elastic search"], related=["OpenSearch"]),
    S("OpenSearch", "search", ["opensearch"], related=["Elasticsearch"]),
    S("Algolia", "search", ["algolia"], related=["Elasticsearch"]),
    S("Klevu", "search", ["klevu"], related=["Algolia"]),
    S("Solr", "search", ["solr", "apache solr"], related=["Elasticsearch"]),
    # Messaging / architecture
    S("RabbitMQ", "messaging", ["rabbitmq", "rabbit mq", "amqp"], related=["Kafka"]),
    S("Kafka", "messaging", ["kafka", "apache kafka"], related=["RabbitMQ"]),
    S(
        "Message Queues",
        "architecture",
        ["message queue", "message queues", "messagequeue", "magento messagequeue", "queue-based"],
        related=["RabbitMQ", "Kafka"],
    ),
    S("Event-Driven Architecture", "architecture", ["event-driven", "event driven"]),
    S("Microservices", "architecture", ["microservices", "micro-services", "microservice"]),
    S(
        "System Design",
        "architecture",
        ["system design", "solution design", "software architecture", "solution architecture"],
    ),
    S("Headless Commerce", "architecture", ["headless commerce", "headless"]),
    # APIs
    S("REST", "api", ["restful", "rest api", "rest apis", "restful apis"], cs=["REST"]),
    S("GraphQL", "api", ["graphql"]),
    S("SOAP", "api", cs=["SOAP"]),
    S("gRPC", "api", ["grpc"]),
    S("Web APIs", "api", ["web api", "web apis"], related=["REST"]),
    # Cloud / DevOps
    S(
        "AWS",
        "cloud",
        ["aws", "amazon web services", "ec2", "s3", "lambda"],
        related=["Azure", "GCP"],
    ),
    S("Azure", "cloud", ["azure", "microsoft azure"], related=["AWS"]),
    S("GCP", "cloud", ["gcp", "google cloud", "google cloud platform"], related=["AWS"]),
    S("Docker", "devops", ["docker", "docker compose", "containers"], related=["Kubernetes"]),
    S("Kubernetes", "devops", ["kubernetes", "k8s", "eks", "aks", "gke"], related=["Docker"]),
    S("Terraform", "devops", ["terraform"]),
    S(
        "CI/CD",
        "devops",
        [
            "ci/cd",
            "ci cd",
            "continuous integration",
            "continuous delivery",
            "continuous deployment",
        ],
    ),
    S("Jenkins", "devops", ["jenkins"], related=["CI/CD"]),
    S("GitHub Actions", "devops", ["github actions"], related=["CI/CD"]),
    S("GitLab CI", "devops", ["gitlab ci", "gitlab-ci"], related=["CI/CD"]),
    S("Linux", "devops", ["linux", "ubuntu", "centos"]),
    S("Nginx", "devops", ["nginx"]),
    S("Fastly", "devops", ["fastly"], related=["Varnish"]),
    S("New Relic", "observability", ["new relic", "newrelic"]),
    S("Git", "tool", ["git", "github", "gitlab", "bitbucket"]),
    S("JIRA", "tool", ["jira"]),
    # Integrations / enterprise
    S("ERP Integration", "integration", ["erp integration", "erp integrations", "erp"]),
    S("SAP", "integration", cs=["SAP"], related=["ERP Integration"]),
    S(
        "Microsoft Dynamics",
        "integration",
        ["microsoft dynamics", "dynamics ax", "dynamics 365", "business central", "navision"],
        related=["ERP Integration"],
    ),
    S(
        "Payment Gateway Integration",
        "integration",
        ["payment gateway", "payment gateways", "payment integration", "payment integrations"],
    ),
    S("Talon.One", "integration", ["talon.one", "talonone"]),
    S("PIM", "integration", ["pim", "akeneo", "pimcore"]),
    # Quality & security
    S("Unit Testing", "testing", ["unit testing", "unit tests", "tdd"]),
    S(
        "Performance Optimization",
        "practice",
        ["performance optimization", "performance tuning", "performance optimisation"],
    ),
    S("Security", "practice", ["security hardening", "owasp", "pci", "pci dss", "csp"]),
    S("Agile", "practice", ["agile", "scrum", "kanban"]),
    # Leadership
    S(
        "Technical Leadership",
        "leadership",
        [
            "technical leadership",
            "tech lead",
            "technical lead",
            "team lead",
            "lead developer",
            "technical direction",
        ],
    ),
    S("Code Review", "leadership", ["code review", "code reviews"]),
    S("Mentoring", "leadership", ["mentoring", "mentored", "mentor"]),
    S(
        "Team Management",
        "leadership",
        ["team management", "people management", "managed a team", "engineering manager"],
    ),
    S(
        "Requirement Analysis",
        "leadership",
        ["requirement analysis", "requirements analysis", "requirement gathering"],
    ),
    S("Estimation", "leadership", ["estimation", "estimations"]),
)


@dataclass(frozen=True)
class Domain:
    name: str
    aliases: tuple[str, ...]
    related: tuple[str, ...] = field(default_factory=tuple)


DOMAINS: tuple[Domain, ...] = (
    Domain(
        "E-commerce",
        (
            "e-commerce",
            "ecommerce",
            "online store",
            "online retail",
            "commerce platform",
            "commerce platforms",
            "storefront",
        ),
        ("Retail", "Marketplace"),
    ),
    Domain("Adobe Commerce", ("adobe commerce", "magento"), ("E-commerce",)),
    Domain("Retail", ("retail", "retailer", "retailers", "omnichannel"), ("E-commerce",)),
    Domain(
        "Grocery & Quick Commerce",
        ("grocery", "quick-commerce", "quick commerce", "supermarket"),
        ("Retail", "E-commerce"),
    ),
    Domain("B2B Commerce", ("b2b",), ("E-commerce",)),
    Domain("Marketplace", ("marketplace", "multi-vendor", "multivendor"), ("E-commerce",)),
    Domain("Payments", ("payments", "payment systems", "payment gateway", "bnpl"), ("FinTech",)),
    Domain("FinTech", ("fintech", "banking", "lending"), ("Payments",)),
    Domain("SaaS", ("saas", "software as a service"), ("Enterprise Software",)),
    Domain(
        "Enterprise Software",
        ("enterprise software", "enterprise e-commerce", "enterprise applications"),
        ("SaaS",),
    ),
    Domain(
        "ERP & Integrations",
        ("erp", "api integrations", "third-party integrations"),
        ("Enterprise Software",),
    ),
    Domain(
        "Logistics & Delivery",
        ("logistics", "delivery partners", "fulfillment", "fulfilment", "shipping"),
        ("E-commerce",),
    ),
    Domain(
        "Headless Commerce",
        ("headless commerce", "headless storefront", "pwa storefront"),
        ("E-commerce",),
    ),
    Domain(
        "Loyalty & Promotions",
        ("loyalty", "promotion engine", "promotion engines"),
        ("E-commerce",),
    ),
    Domain("Healthcare", ("healthcare", "health tech", "healthtech", "pharma"), ()),
    Domain("EdTech", ("edtech", "education technology", "e-learning"), ()),
    Domain("Travel", ("travel", "hospitality"), ()),
    Domain("Media", ("media", "publishing"), ()),
    Domain("Gaming", ("gaming",), ()),
    Domain("Insurance", ("insurance", "insurtech"), ("FinTech",)),
)

SKILLS_BY_NAME: dict[str, Skill] = {s.name: s for s in SKILLS}
DOMAINS_BY_NAME: dict[str, Domain] = {d.name: d for d in DOMAINS}


def _pattern(alias: str) -> str:
    # Word-ish boundaries that also work for aliases starting/ending in symbols (".net", "c#").
    return rf"(?<![\w.+#-]){re.escape(alias)}(?![\w+#]|\.\w)"


@lru_cache
def _alias_table() -> list[tuple[re.Pattern[str], str]]:
    entries: list[tuple[str, str, bool]] = []
    for s in SKILLS:
        # Very short canonical names ("Go") are too ambiguous to detect by name alone;
        # such skills are found only through their explicit aliases ("golang").
        names = s.aliases if len(s.name) <= 2 else (s.name, *s.aliases)
        for a in names:
            if a in s.case_sensitive:
                continue
            entries.append((a, s.name, False))
        for a in s.case_sensitive:
            entries.append((a, s.name, True))
    entries.sort(key=lambda e: len(e[0]), reverse=True)
    table = []
    for alias, name, cs in entries:
        flags = 0 if cs else re.IGNORECASE
        table.append((re.compile(_pattern(alias), flags), name))
    return table


def find_skills(text: str) -> dict[str, int]:
    """Canonical skill -> number of mentions in `text` (longest alias wins on overlaps)."""
    counts: dict[str, int] = {}
    taken = bytearray(len(text))
    for pattern, name in _alias_table():
        for m in pattern.finditer(text):
            if any(taken[m.start() : m.end()]):
                continue
            taken[m.start() : m.end()] = b"\x01" * (m.end() - m.start())
            counts[name] = counts.get(name, 0) + 1
    return counts


def normalize_skill(raw: str) -> str | None:
    """Canonical name for a free-text skill ("magento2" -> "Magento 2"), or None if unknown."""
    raw = raw.strip()
    if not raw:
        return None
    if raw in SKILLS_BY_NAME:
        return raw
    found = find_skills(raw)
    if len(found) == 1:
        return next(iter(found))
    lowered = raw.lower()
    for s in SKILLS:
        if lowered == s.name.lower() or lowered in (a.lower() for a in s.aliases):
            return s.name
    return None


def normalize_skill_list(raw: list[str]) -> list[str]:
    """Canonicalize known skills, keep unknown ones as typed, de-duplicate, keep order."""
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        name = normalize_skill(item) or item.strip()
        if name and name.lower() not in seen:
            seen.add(name.lower())
            out.append(name)
    return out


def ancestors(name: str) -> list[str]:
    """Parent chain, e.g. "Adobe Commerce Cloud" -> Adobe Commerce, Magento 2, Magento."""
    chain: list[str] = []
    current = SKILLS_BY_NAME.get(name)
    while current and current.parent and current.parent not in chain:
        chain.append(current.parent)
        current = SKILLS_BY_NAME.get(current.parent)
    return chain


def related(name: str) -> set[str]:
    skill = SKILLS_BY_NAME.get(name)
    if not skill:
        return set()
    out = set(skill.related)
    out.update(s.name for s in SKILLS if name in s.related)
    return out


def skill_category(name: str) -> str | None:
    s = SKILLS_BY_NAME.get(name)
    return s.category if s else None


def find_domains(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for d in DOMAINS:
        n = 0
        for alias in d.aliases:
            n += len(re.findall(_pattern(alias), text, re.IGNORECASE))
        if n:
            counts[d.name] = n
    return counts
