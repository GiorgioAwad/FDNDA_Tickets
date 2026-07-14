const AC_MATRICULA_GROUP_KEY = /^AC:[^:]+:matricula:(.+)$/i

export function getAcMatriculaFromGroupKey(groupKey: string): string | null {
    const match = AC_MATRICULA_GROUP_KEY.exec(groupKey.trim())
    const matricula = match?.[1]?.trim()
    return matricula ? matricula.toUpperCase() : null
}

/**
 * Un comprobante AC emitido pertenece fiscalmente a la matrícula, aunque luego
 * se corrija la sede operativa y cambie la clave de agrupación de Servilex.
 */
export function isCoveredByIssuedAcMatricula(
    groupKey: string,
    issuedGroupKeys: Iterable<string>
): boolean {
    const matricula = getAcMatriculaFromGroupKey(groupKey)
    if (!matricula) return false

    for (const issuedGroupKey of issuedGroupKeys) {
        if (getAcMatriculaFromGroupKey(issuedGroupKey) === matricula) return true
    }
    return false
}
