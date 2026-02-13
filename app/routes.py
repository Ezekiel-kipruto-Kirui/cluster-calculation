from flask import Blueprint, current_app, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from app.models import (
    SUBJECTS,
    admin_required,
    check_subject_requirements,
    db,
    parse_requirements_text,
    parse_universities_and_cutoffs,
)
from app.mpesa import mpesa_is_configured, normalize_phone_number, start_stk_push
from clusters import compute_cluster, medicine_eligibility

main_bp = Blueprint("main", __name__)


def _collect_grades(form):
    return {
        "ENG": form.get("English", ""),
        "KIS": form.get("Kiswahili", ""),
        "MAT": form.get("Mathematics", ""),
        "BIO": form.get("Biology", ""),
        "CHE": form.get("Chemistry", ""),
        "PHY": form.get("Physics", ""),
        "GSC": form.get("General Science", ""),
        "HAG": form.get("History", ""),
        "GEO": form.get("Geography", ""),
        "CRE": form.get("CRE", ""),
        "IRE": form.get("IRE", ""),
        "HRE": form.get("HRE", ""),
        "CMP": form.get("Computer Studies", ""),
        "AGR": form.get("Agriculture", ""),
        "ARD": form.get("Art & Design", ""),
        "HSC": form.get("Home Science", ""),
        "BST": form.get("Business Studies", ""),
        "FRE": form.get("French", ""),
        "GER": form.get("German", ""),
        "MUS": form.get("Music", ""),
        "ARB": form.get("Arabic", ""),
    }


def _compute_and_store_results(grades):
    session["grades"] = grades
    session["medicine_eligible"] = medicine_eligibility(grades)

    results = {}
    for c in range(1, 21):
        results[c] = compute_cluster(c, grades)

    conn = db()
    cur = conn.cursor()
    cur.execute("SELECT name, cluster FROM courses")
    rows = cur.fetchall()
    conn.close()

    cluster_courses = {c: [] for c in range(1, 21)}
    for name, cluster in rows:
        if cluster in cluster_courses:
            cluster_courses[cluster].append({"name": name})

    session["results"] = results
    session["cluster_courses"] = cluster_courses


def _get_payment(checkout_request_id):
    if not checkout_request_id:
        return None
    conn = db(row_factory=True)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT checkout_request_id, phone_number, amount, status, result_code, result_desc, mpesa_receipt
        FROM payments
        WHERE checkout_request_id = ?
        """,
        (checkout_request_id,),
    )
    payment = cur.fetchone()
    conn.close()
    return payment


def _payment_template_context(error=None, info=None):
    checkout_request_id = session.get("pending_checkout_request_id")
    payment = _get_payment(checkout_request_id)
    return {
        "amount": current_app.config["CLUSTER_CALC_AMOUNT"],
        "error": error,
        "info": info,
        "payment": payment,
        "phone_number": session.get("pending_phone_number", ""),
        "mpesa_enabled": current_app.config["MPESA_ENABLED"],
        "mpesa_ready": mpesa_is_configured(),
    }


def _parse_result_code(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


@main_bp.route("/")
def home():
    return render_template("student/landing.html", amount=current_app.config["CLUSTER_CALC_AMOUNT"])


@main_bp.route("/calculator")
def calculator():
    return render_template(
        "student/calculator.html",
        amount=current_app.config["CLUSTER_CALC_AMOUNT"],
    )


@main_bp.route("/calculate", methods=["POST"])
def calculate():
    grades = _collect_grades(request.form)
    session["pending_grades"] = grades
    session["pending_medicine_eligible"] = medicine_eligibility(grades)
    session.pop("pending_checkout_request_id", None)
    session.pop("pending_phone_number", None)
    return redirect(url_for("main.payment_page"))


@main_bp.route("/payment", methods=["GET"])
def payment_page():
    if "pending_grades" not in session:
        return redirect(url_for("main.calculator"))
    return render_template("student/payment.html", **_payment_template_context())


@main_bp.route("/payment/initiate", methods=["POST"])
def initiate_payment():
    if "pending_grades" not in session:
        return redirect(url_for("main.calculator"))

    if not current_app.config["MPESA_ENABLED"]:
        context = _payment_template_context(error="M-Pesa payments are currently disabled.")
        return render_template("student/payment.html", **context), 503

    if not mpesa_is_configured():
        context = _payment_template_context(
            error="M-Pesa is not fully configured. Set your Daraja credentials and callback URL."
        )
        return render_template("student/payment.html", **context), 503

    phone_number = normalize_phone_number(request.form.get("phone_number", ""))
    if not phone_number:
        context = _payment_template_context(
            error="Enter a valid Safaricom number (e.g. 0712345678 or 254712345678)."
        )
        return render_template("student/payment.html", **context), 400

    amount = max(1, int(current_app.config["CLUSTER_CALC_AMOUNT"]))
    try:
        response = start_stk_push(phone_number, amount)
    except RuntimeError as exc:
        context = _payment_template_context(error=str(exc))
        return render_template("student/payment.html", **context), 502

    if str(response.get("ResponseCode", "")) != "0":
        context = _payment_template_context(
            error=response.get("errorMessage") or response.get("CustomerMessage") or "STK push failed."
        )
        return render_template("student/payment.html", **context), 502

    checkout_request_id = response.get("CheckoutRequestID")
    merchant_request_id = response.get("MerchantRequestID")
    if not checkout_request_id:
        context = _payment_template_context(error="CheckoutRequestID was not returned by M-Pesa.")
        return render_template("student/payment.html", **context), 502

    conn = db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO payments (
            checkout_request_id, merchant_request_id, phone_number, amount, status, result_desc
        )
        VALUES (?, ?, ?, ?, 'PENDING', ?)
        ON CONFLICT(checkout_request_id) DO UPDATE SET
            merchant_request_id = excluded.merchant_request_id,
            phone_number = excluded.phone_number,
            amount = excluded.amount,
            status = 'PENDING',
            result_desc = excluded.result_desc,
            updated_at = CURRENT_TIMESTAMP
        """,
        (
            checkout_request_id,
            merchant_request_id,
            phone_number,
            amount,
            response.get("CustomerMessage"),
        ),
    )
    conn.commit()
    conn.close()

    session["pending_checkout_request_id"] = checkout_request_id
    session["pending_phone_number"] = phone_number

    context = _payment_template_context(
        info=response.get("CustomerMessage") or "STK push sent. Complete payment on your phone."
    )
    return render_template("student/payment.html", **context)


@main_bp.route("/payment/status-json")
def payment_status_json():
    checkout_request_id = session.get("pending_checkout_request_id")
    if not checkout_request_id:
        return jsonify({"status": "NOT_STARTED", "message": "No payment in progress."})

    payment = _get_payment(checkout_request_id)
    if not payment:
        return jsonify({"status": "NOT_FOUND", "message": "Payment record not found."}), 404

    return jsonify(
        {
            "status": payment["status"],
            "result_code": payment["result_code"],
            "result_desc": payment["result_desc"],
            "checkout_request_id": payment["checkout_request_id"],
            "mpesa_receipt": payment["mpesa_receipt"],
        }
    )


@main_bp.route("/payment/continue", methods=["GET"])
def continue_after_payment():
    if "pending_grades" not in session:
        return redirect(url_for("main.calculator"))

    checkout_request_id = session.get("pending_checkout_request_id")
    if not checkout_request_id:
        context = _payment_template_context(error="No M-Pesa checkout in progress. Start payment first.")
        return render_template("student/payment.html", **context), 400

    payment = _get_payment(checkout_request_id)
    if not payment:
        context = _payment_template_context(error="Payment record was not found.")
        return render_template("student/payment.html", **context), 404

    if payment["status"] != "SUCCESS":
        context = _payment_template_context(
            error=f"Payment not confirmed yet. Current status: {payment['status']}."
        )
        return render_template("student/payment.html", **context), 400

    grades = session.pop("pending_grades")
    session.pop("pending_medicine_eligible", None)
    session.pop("pending_checkout_request_id", None)
    session.pop("pending_phone_number", None)
    _compute_and_store_results(grades)
    return redirect(url_for("main.results"))


@main_bp.route("/payment/callback", methods=["POST"])
def mpesa_callback():
    payload = request.get_json(silent=True) or {}
    callback = (payload.get("Body") or {}).get("stkCallback") or {}

    checkout_request_id = callback.get("CheckoutRequestID")
    merchant_request_id = callback.get("MerchantRequestID")
    result_code = _parse_result_code(callback.get("ResultCode"))
    result_desc = callback.get("ResultDesc")
    status = "SUCCESS" if result_code == 0 else "FAILED"

    amount_paid = None
    receipt = None
    metadata_items = ((callback.get("CallbackMetadata") or {}).get("Item") or [])
    for item in metadata_items:
        name = item.get("Name")
        value = item.get("Value")
        if name == "Amount":
            try:
                amount_paid = int(float(value))
            except (TypeError, ValueError):
                amount_paid = None
        if name == "MpesaReceiptNumber":
            receipt = value

    if checkout_request_id:
        conn = db()
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE payments
            SET
                merchant_request_id = COALESCE(?, merchant_request_id),
                status = ?,
                result_code = ?,
                result_desc = ?,
                mpesa_receipt = COALESCE(?, mpesa_receipt),
                amount = COALESCE(?, amount),
                updated_at = CURRENT_TIMESTAMP
            WHERE checkout_request_id = ?
            """,
            (
                merchant_request_id,
                status,
                result_code,
                result_desc,
                receipt,
                amount_paid,
                checkout_request_id,
            ),
        )
        conn.commit()
        conn.close()

    return jsonify({"ResultCode": 0, "ResultDesc": "Accepted"})


@main_bp.route("/results")
def results():
    if "results" not in session:
        return redirect(url_for("main.calculator"))

    return render_template(
        "student/results.html",
        results=session["results"],
        cluster_courses=session.get("cluster_courses", {}),
    )


@main_bp.route("/check-course")
def check_course():
    try:
        cluster = int(request.args.get("cluster", "0"))
        points = float(request.args.get("points", "0"))
    except ValueError:
        return "Invalid cluster or points", 400

    course_name = (request.args.get("course_name") or "").strip()
    if not course_name:
        return "Missing course_name", 400

    conn = db()
    cur = conn.cursor()
    cur.execute(
        "SELECT id FROM courses WHERE name=? AND cluster=? ORDER BY id ASC LIMIT 1",
        (course_name, cluster),
    )
    row = cur.fetchone()
    if not row:
        conn.close()
        return "Course not found for this cluster", 404

    course_id = row[0]

    cur.execute("SELECT subject, grade FROM requirements WHERE course_id=?", (course_id,))
    requirements = dict(cur.fetchall())

    cur.execute("SELECT name, cutoff FROM universities WHERE course_id=?", (course_id,))
    universities = cur.fetchall()
    conn.close()

    subject_check = check_subject_requirements(session.get("grades", {}), requirements)
    qualified = []
    not_qualified = []

    if subject_check["passed"]:
        for uni, cutoff in universities:
            if points >= cutoff:
                qualified.append((uni, cutoff))
            else:
                not_qualified.append((uni, cutoff))

    return render_template(
        "student/course_result.html",
        course=course_name,
        cluster=cluster,
        points=points,
        subject_check=subject_check,
        qualified=qualified,
        not_qualified=not_qualified,
    )


@main_bp.route("/admin", methods=["GET", "POST"])
def admin_login():
    if request.method == "POST":
        username = request.form["username"].strip()
        password = request.form["password"]

        conn = db(row_factory=True)
        c = conn.cursor()
        c.execute("SELECT * FROM admins WHERE username = ?", (username,))
        admin = c.fetchone()
        conn.close()

        if admin and check_password_hash(admin["password"], password):
            session["admin"] = True
            session["admin_username"] = admin["username"]
            return redirect("/admin/dashboard")

        return render_template("admin/login.html", error="Invalid login")

    return render_template("admin/login.html")


@main_bp.route("/admin/dashboard")
@admin_required
def admin_dashboard():
    conn = db()
    cur = conn.cursor()
    cur.execute("SELECT id, name, cluster FROM courses ORDER BY cluster, id")
    rows = cur.fetchall()

    courses = {c: [] for c in range(1, 21)}
    for cid, name, cluster in rows:
        cur.execute("SELECT subject, grade FROM requirements WHERE course_id=?", (cid,))
        reqs = dict(cur.fetchall())

        cur.execute("SELECT name, cutoff FROM universities WHERE course_id=?", (cid,))
        unis = [{"name": u, "cutoff": c} for u, c in cur.fetchall()]

        if cluster in courses:
            courses[cluster].append(
                {"id": cid, "name": name, "requirements": reqs, "universities": unis}
            )

    conn.close()
    return render_template("admin/dashboard.html", courses=courses, subjects=SUBJECTS)


@main_bp.route("/admin/add-course", methods=["GET"])
@admin_required
def add_course_page():
    return render_template("admin/add_course.html")


@main_bp.route("/admin/add-course", methods=["POST"])
@admin_required
def add_course():
    name = request.form.get("name", "").strip()
    if not name:
        return "Course name is required", 400

    try:
        cluster = int(request.form["cluster"])
    except (TypeError, ValueError):
        return "Invalid cluster value", 400

    if cluster < 1 or cluster > 20:
        return "Cluster must be between 1 and 20", 400

    requirements_rows = parse_requirements_text(request.form.get("requirements", ""))
    university_rows = parse_universities_and_cutoffs(
        request.form.get("universities", ""), request.form.get("cutoffs", "")
    )

    conn = db()
    cur = conn.cursor()
    cur.execute("INSERT INTO courses (name, cluster) VALUES (?, ?)", (name, cluster))
    course_id = cur.lastrowid

    for subject, grade in requirements_rows:
        cur.execute(
            "INSERT INTO requirements (course_id, subject, grade) VALUES (?, ?, ?)",
            (course_id, subject, grade),
        )

    for uni_name, cutoff_value in university_rows:
        cur.execute(
            "INSERT INTO universities (course_id, name, cutoff) VALUES (?, ?, ?)",
            (course_id, uni_name, cutoff_value),
        )

    conn.commit()
    conn.close()
    return redirect("/admin/dashboard")


@main_bp.route("/admin/edit/<int:course_id>", methods=["GET", "POST"])
@admin_required
def edit_course(course_id):
    conn = db(row_factory=True)
    c = conn.cursor()

    if request.method == "POST":
        name = request.form.get("name", "").strip()
        if not name:
            conn.close()
            return "Course name is required", 400

        try:
            cluster = int(request.form["cluster"])
        except (TypeError, ValueError):
            conn.close()
            return "Invalid cluster value", 400

        if cluster < 1 or cluster > 20:
            conn.close()
            return "Cluster must be between 1 and 20", 400

        c.execute(
            "UPDATE courses SET name = ?, cluster = ? WHERE id = ?",
            (name, cluster, course_id),
        )

        c.execute("DELETE FROM requirements WHERE course_id = ?", (course_id,))
        c.execute("DELETE FROM universities WHERE course_id = ?", (course_id,))

        requirements_rows = parse_requirements_text(request.form.get("requirements", ""))
        for subject, grade in requirements_rows:
            c.execute(
                "INSERT INTO requirements (course_id, subject, grade) VALUES (?, ?, ?)",
                (course_id, subject, grade),
            )

        university_rows = parse_universities_and_cutoffs(
            request.form.get("universities", ""), request.form.get("cutoffs", "")
        )
        for uni_name, cutoff_value in university_rows:
            c.execute(
                "INSERT INTO universities (course_id, name, cutoff) VALUES (?, ?, ?)",
                (course_id, uni_name, cutoff_value),
            )

        conn.commit()
        conn.close()
        return redirect("/admin/dashboard")

    c.execute("SELECT * FROM courses WHERE id = ?", (course_id,))
    course = c.fetchone()
    if not course:
        conn.close()
        return "Course not found", 404

    c.execute(
        "SELECT subject, grade FROM requirements WHERE course_id = ? ORDER BY id", (course_id,)
    )
    requirements_lines = [f"{subject}: {grade}" for subject, grade in c.fetchall()]

    c.execute(
        "SELECT name, cutoff FROM universities WHERE course_id = ? ORDER BY id", (course_id,)
    )
    universities = c.fetchall()
    conn.close()

    course_data = dict(course)
    course_data["requirements"] = "\n".join(requirements_lines)
    course_data["universities"] = "\n".join([u["name"] for u in universities])
    course_data["cutoffs"] = "\n".join([str(u["cutoff"]) for u in universities])

    return render_template("admin/edit_course.html", course=course_data)


@main_bp.route("/admin/courses")
@admin_required
def view_courses():
    conn = db()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT c.id, c.name, c.cluster, u.name, u.cutoff
        FROM courses c
        LEFT JOIN universities u ON c.id = u.course_id
        ORDER BY c.cluster, c.id, u.id
        """
    )
    rows = cur.fetchall()
    conn.close()

    courses = {}
    for cid, cname, cluster, uni, cutoff in rows:
        courses.setdefault(cluster, []).append(
            {"id": cid, "name": cname, "university": uni, "cutoff": cutoff}
        )

    return render_template("admin/courses.html", courses=courses)


@main_bp.route("/admin/course/delete/<int:course_id>", methods=["POST"])
@admin_required
def delete_course(course_id):
    conn = db()
    cur = conn.cursor()
    cur.execute("DELETE FROM universities WHERE course_id = ?", (course_id,))
    cur.execute("DELETE FROM requirements WHERE course_id = ?", (course_id,))
    cur.execute("DELETE FROM courses WHERE id = ?", (course_id,))
    conn.commit()
    conn.close()
    return redirect(url_for("main.admin_dashboard"))


@main_bp.route("/admin/settings", methods=["GET", "POST"])
@admin_required
def admin_settings():
    if request.method == "POST":
        new_username = request.form.get("username", "").strip()
        new_password = request.form.get("password", "").strip()
        if not new_username or not new_password:
            return "Username and password are required", 400

        hashed_password = generate_password_hash(new_password)
        current_username = session.get("admin_username")

        conn = db()
        c = conn.cursor()
        if current_username:
            c.execute(
                "UPDATE admins SET username = ?, password = ? WHERE username = ?",
                (new_username, hashed_password, current_username),
            )
        else:
            c.execute(
                "UPDATE admins SET username = ?, password = ? WHERE id = 1",
                (new_username, hashed_password),
            )

        conn.commit()
        conn.close()

        session["admin_username"] = new_username
        return redirect("/admin/dashboard")

    return render_template("admin/settings.html")


@main_bp.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("main.home"))
