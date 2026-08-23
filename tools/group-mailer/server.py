#!/usr/bin/env python3
"""Local backend for the Group Mailer tool.

Runs on your own machine, keeps SMTP credentials out of the (public,
GitHub-Pages-hosted) frontend, and exposes a small JSON API that
tools/group-mailer/mailer.js talks to over http://localhost.

Usage:
    python3 server.py [port]

Reads credentials from ../../secrets.env (SMTP_USER, SMTP_PASS, SMTP_HOST,
SMTP_PORT). Contacts and groups are persisted to data.json next to this file.
"""

import json
import os
import re
import smtplib
import ssl
import sys
import uuid
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(HERE, "data.json")
SECRETS_FILE = os.path.join(HERE, "..", "..", "secrets.env")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def load_secrets():
    secrets = {}
    try:
        with open(SECRETS_FILE, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                secrets[key.strip()] = value.strip()
    except FileNotFoundError:
        pass
    return secrets


def load_data():
    try:
        with open(DATA_FILE, "r") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    data.setdefault("contacts", [])
    data.setdefault("groups", [])
    return data


def save_data(data):
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, DATA_FILE)


DATA = load_data()


def send_group_email(secrets, to_addrs, subject, body):
    user = secrets.get("SMTP_USER")
    password = secrets.get("SMTP_PASS")
    host = secrets.get("SMTP_HOST", "smtp.protonmail.ch")
    port = int(secrets.get("SMTP_PORT", "587"))

    if not user or not password:
        raise RuntimeError("SMTP_USER / SMTP_PASS missing from secrets.env")

    sent, failed = [], []
    context = ssl.create_default_context()
    with smtplib.SMTP(host, port, timeout=20) as smtp:
        smtp.ehlo()
        smtp.starttls(context=context)
        smtp.ehlo()
        smtp.login(user, password)
        for addr in to_addrs:
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = user
            msg["To"] = addr
            msg.set_content(body)
            try:
                smtp.send_message(msg)
                sent.append(addr)
            except smtplib.SMTPException as e:
                failed.append({"email": addr, "error": str(e)})
    return sent, failed


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8") or "{}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/health":
            secrets = load_secrets()
            self._send_json(200, {"ok": True, "from": secrets.get("SMTP_USER", "")})
        elif path == "/api/contacts":
            self._send_json(200, DATA["contacts"])
        elif path == "/api/groups":
            self._send_json(200, DATA["groups"])
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            body = self._read_json()
        except (json.JSONDecodeError, UnicodeDecodeError):
            return self._send_json(400, {"error": "invalid JSON body"})

        if path == "/api/contacts":
            name = (body.get("name") or "").strip()
            email = (body.get("email") or "").strip()
            if not name or not EMAIL_RE.match(email):
                return self._send_json(400, {"error": "name and a valid email are required"})
            contact = {"id": uuid.uuid4().hex[:8], "name": name, "email": email}
            DATA["contacts"].append(contact)
            save_data(DATA)
            return self._send_json(201, contact)

        if path == "/api/groups":
            name = (body.get("name") or "").strip()
            contact_ids = body.get("contactIds") or []
            if not name:
                return self._send_json(400, {"error": "group name is required"})
            group = {"id": uuid.uuid4().hex[:8], "name": name, "contactIds": contact_ids}
            DATA["groups"].append(group)
            save_data(DATA)
            return self._send_json(201, group)

        if path == "/api/send":
            group_id = body.get("groupId")
            subject = (body.get("subject") or "").strip()
            content = body.get("body") or ""
            group = next((g for g in DATA["groups"] if g["id"] == group_id), None)
            if not group:
                return self._send_json(404, {"error": "group not found"})
            if not subject:
                return self._send_json(400, {"error": "subject is required"})
            contacts_by_id = {c["id"]: c for c in DATA["contacts"]}
            to_addrs = [contacts_by_id[cid]["email"] for cid in group["contactIds"] if cid in contacts_by_id]
            if not to_addrs:
                return self._send_json(400, {"error": "group has no valid contacts"})
            secrets = load_secrets()
            try:
                sent, failed = send_group_email(secrets, to_addrs, subject, content)
            except (smtplib.SMTPException, RuntimeError, OSError) as e:
                return self._send_json(502, {"error": str(e)})
            return self._send_json(200, {"sent": sent, "failed": failed})

        return self._send_json(404, {"error": "not found"})

    def do_PUT(self):
        path = self.path.split("?")[0]
        try:
            body = self._read_json()
        except (json.JSONDecodeError, UnicodeDecodeError):
            return self._send_json(400, {"error": "invalid JSON body"})

        if path.startswith("/api/groups/"):
            group_id = path[len("/api/groups/"):]
            group = next((g for g in DATA["groups"] if g["id"] == group_id), None)
            if not group:
                return self._send_json(404, {"error": "group not found"})
            if "name" in body:
                name = (body.get("name") or "").strip()
                if not name:
                    return self._send_json(400, {"error": "group name is required"})
                group["name"] = name
            if "contactIds" in body:
                group["contactIds"] = body.get("contactIds") or []
            save_data(DATA)
            return self._send_json(200, group)

        return self._send_json(404, {"error": "not found"})

    def do_DELETE(self):
        path = self.path.split("?")[0]

        if path.startswith("/api/contacts/"):
            contact_id = path[len("/api/contacts/"):]
            before = len(DATA["contacts"])
            DATA["contacts"] = [c for c in DATA["contacts"] if c["id"] != contact_id]
            if len(DATA["contacts"]) == before:
                return self._send_json(404, {"error": "contact not found"})
            for g in DATA["groups"]:
                g["contactIds"] = [cid for cid in g["contactIds"] if cid != contact_id]
            save_data(DATA)
            return self._send_json(200, {})

        if path.startswith("/api/groups/"):
            group_id = path[len("/api/groups/"):]
            before = len(DATA["groups"])
            DATA["groups"] = [g for g in DATA["groups"] if g["id"] != group_id]
            if len(DATA["groups"]) == before:
                return self._send_json(404, {"error": "group not found"})
            save_data(DATA)
            return self._send_json(200, {})

        return self._send_json(404, {"error": "not found"})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Group Mailer server running at http://127.0.0.1:{port}")
    print("Leave this running while you use the Group Mailer tool in your browser.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
