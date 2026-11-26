import test from "node:test"
import assert from "node:assert/strict"
import { AttendeeRenameError, normalizeAttendeeNameInput, planAttendeeRename } from "@/lib/membership-attendee-rename"

const ticket = { status: "ACTIVE", attendeeName: "Lucy Bustamante Oré", attendeeDni: "40123456" }
const attendee = {
    name: "Lucy Bustamante Oré", firstName: "Lucy", secondName: "", lastNamePaternal: "Bustamante", lastNameMaternal: "Oré",
    dni: "40123456", matricula: "MAT-1", membershipSchedule: { profileKey: "VERANO_3X" },
}

test("renombra la única entrada conservando DNI, matrícula y horario", () => {
    const name = normalizeAttendeeNameInput({ firstName: "  María  José ", lastNamePaternal: "Bustamante", lastNameMaternal: "Oré" })
    const plan = planAttendeeRename({ ticket, orderStatus: "PAID", attendeeData: [attendee], name })
    assert.equal(plan.afterName, "María José Bustamante Oré")
    assert.equal(plan.beforeName, "Lucy Bustamante Oré")
    const [updated] = plan.attendeeData as Array<Record<string, unknown>>
    assert.equal(updated.name, "María José Bustamante Oré")
    assert.equal(updated.firstName, "María José")
    assert.equal(updated.secondName, "")
    assert.equal(updated.dni, "40123456")
    assert.equal(updated.matricula, "MAT-1")
    assert.deepEqual(updated.membershipSchedule, { profileKey: "VERANO_3X" })
})

test("en una compra de varios asistentes cambia solo el del carnet (nombre + DNI)", () => {
    const other = { ...attendee, name: "Pedro Bustamante Oré", firstName: "Pedro", dni: "40999999" }
    const plan = planAttendeeRename({
        ticket, orderStatus: "PAID", attendeeData: [other, attendee],
        name: normalizeAttendeeNameInput({ firstName: "Lucía", lastNamePaternal: "Bustamante" }),
    })
    assert.equal(plan.index, 1)
    assert.equal((plan.attendeeData[0] as Record<string, unknown>).name, "Pedro Bustamante Oré")
    assert.equal((plan.attendeeData[1] as Record<string, unknown>).name, "Lucía Bustamante")
    assert.throws(
        () => planAttendeeRename({ ticket, orderStatus: "PAID", attendeeData: [attendee, attendee], name: normalizeAttendeeNameInput({ firstName: "Ana", lastNamePaternal: "Ruiz" }) }),
        /ambigüedad/
    )
})

test("rechaza carnets no activos, nombres vacíos o inválidos y el mismo nombre", () => {
    const name = normalizeAttendeeNameInput({ firstName: "Ana", lastNamePaternal: "Ruiz" })
    assert.throws(() => planAttendeeRename({ ticket: { ...ticket, status: "CANCELLED" }, orderStatus: "PAID", attendeeData: [attendee], name }), AttendeeRenameError)
    assert.throws(() => planAttendeeRename({ ticket, orderStatus: "PENDING", attendeeData: [attendee], name }), /activos y pagados/)
    assert.throws(() => normalizeAttendeeNameInput({ firstName: "A", lastNamePaternal: "Ruiz" }), /primer nombre/)
    assert.throws(() => normalizeAttendeeNameInput({ firstName: "Ana", lastNamePaternal: "" }), /apellido paterno/)
    assert.throws(() => normalizeAttendeeNameInput({ firstName: "Ana<script>", lastNamePaternal: "Ruiz" }), /solo pueden tener letras/)
    assert.throws(
        () => planAttendeeRename({ ticket, orderStatus: "PAID", attendeeData: [attendee], name: normalizeAttendeeNameInput({ firstName: "Lucy", lastNamePaternal: "Bustamante", lastNameMaternal: "Oré" }) }),
        /igual al actual/
    )
    // Corregir solo mayúsculas sí es un cambio válido.
    assert.doesNotThrow(() => planAttendeeRename({ ticket, orderStatus: "PAID", attendeeData: [attendee], name: normalizeAttendeeNameInput({ firstName: "LUCY", lastNamePaternal: "BUSTAMANTE", lastNameMaternal: "ORÉ" }) }))
})
