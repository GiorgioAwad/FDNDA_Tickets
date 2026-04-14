import test from "node:test"
import assert from "node:assert/strict"
import { parseScheduleTimeWindow } from "@/lib/abio-catalog"

test("parseScheduleTimeWindow extrae horas y duracion desde descripcion de horario", () => {
    assert.deepEqual(parseScheduleTimeWindow("Lun Mar Mie Jue Vie 06:00 - 07:00"), {
        horaInicio: "06:00",
        horaFin: "07:00",
        duracionHoras: 1,
    })
})

test("parseScheduleTimeWindow soporta medias horas", () => {
    assert.deepEqual(parseScheduleTimeWindow("Sab Dom 09:30 - 11:00"), {
        horaInicio: "09:30",
        horaFin: "11:00",
        duracionHoras: 1.5,
    })
})

test("parseScheduleTimeWindow devuelve null si no encuentra rango valido", () => {
    assert.deepEqual(parseScheduleTimeWindow("Horario sin rango"), {
        horaInicio: null,
        horaFin: null,
        duracionHoras: null,
    })
})
