"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
    Loader2, 
    Users, 
    Search,
    Shield,
    Mail,
    Calendar,
    CheckCircle,
    Clock,
    UserPlus,
    MoreVertical,
    UserCog,
    Trash2,
    X,
    KeyRound,
    Copy,
} from "lucide-react"

// Modal component that renders via portal
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
        // Prevent body scroll when modal is open
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = 'unset'
        }
    }, [])

    if (!mounted) return null

    return createPortal(
        <div 
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose()
            }}
        >
            {children}
        </div>,
        document.body
    )
}

interface UserData {
    id: string
    name: string
    email: string
    role: "ADMIN" | "STAFF" | "USER"
    emailVerifiedAt: string | null
    createdAt: string
    _count: {
        tickets: number
        orders: number
    }
}

interface UsersPageData {
    users: UserData[]
    totalUsers: number
    admins: number
    scanners: number
    verified: number
}

export default function UsuariosPage() {
    const [data, setData] = useState<UsersPageData | null>(null)
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState("")
    const [filter, setFilter] = useState<"all" | "ADMIN" | "STAFF" | "USER">("all")
    
    // Modal states
    const [showRoleModal, setShowRoleModal] = useState(false)
    const [selectedUser, setSelectedUser] = useState<UserData | null>(null)
    const [updatingRole, setUpdatingRole] = useState(false)
    const [showAddStaffModal, setShowAddStaffModal] = useState(false)
    const [newStaffEmail, setNewStaffEmail] = useState("")
    const [newStaffName, setNewStaffName] = useState("")
    const [addingStaff, setAddingStaff] = useState(false)
    
    // Reset password states
    const [showResetPasswordModal, setShowResetPasswordModal] = useState(false)
    const [resetPasswordUser, setResetPasswordUser] = useState<UserData | null>(null)
    const [resettingPassword, setResettingPassword] = useState(false)
    const [newTempPassword, setNewTempPassword] = useState("")

    const fetchUsers = async () => {
        try {
            const response = await fetch("/api/admin/users")
            const result = await response.json()
            if (result.success) {
                setData(result.data)
            }
        } catch (error) {
            console.error("Error loading users:", error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchUsers()
    }, [])

    const handleRoleChange = async (userId: string, newRole: "ADMIN" | "STAFF" | "USER") => {
        setUpdatingRole(true)
        try {
            const response = await fetch(`/api/admin/users/${userId}/role`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role: newRole })
            })
            const result = await response.json()
            if (result.success) {
                await fetchUsers()
                setShowRoleModal(false)
                setSelectedUser(null)
            } else {
                alert(result.error || "Error al cambiar rol")
            }
        } catch (error) {
            console.error("Error updating role:", error)
            alert("Error al actualizar rol")
        } finally {
            setUpdatingRole(false)
        }
    }

    const handleAddStaff = async (e: React.FormEvent) => {
        e.preventDefault()
        setAddingStaff(true)
        try {
            const response = await fetch("/api/admin/users/create-staff", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    email: newStaffEmail,
                    name: newStaffName,
                })
            })
            const result = await response.json()
            if (result.success) {
                await fetchUsers()
                setShowAddStaffModal(false)
                setNewStaffEmail("")
                setNewStaffName("")
                alert(`Usuario Staff creado. Contraseña temporal: ${result.data.tempPassword}`)
            } else {
                alert(result.error || "Error al crear usuario")
            }
        } catch (error) {
            console.error("Error creating staff:", error)
            alert("Error al crear usuario staff")
        } finally {
            setAddingStaff(false)
        }
    }

    const handleResetPassword = async () => {
        if (!resetPasswordUser) return
        setResettingPassword(true)
        try {
            const response = await fetch(`/api/admin/users/${resetPasswordUser.id}/reset-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            })
            const result = await response.json()
            if (result.success) {
                setNewTempPassword(result.data.tempPassword)
            } else {
                alert(result.error || "Error al resetear contraseña")
            }
        } catch (error) {
            console.error("Error resetting password:", error)
            alert("Error al resetear contraseña")
        } finally {
            setResettingPassword(false)
        }
    }

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text)
        alert("Copiado al portapapeles")
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
        )
    }

    const usersData = data || { users: [], totalUsers: 0, admins: 0, scanners: 0, verified: 0 }

    // Filter users
    const filteredUsers = usersData.users.filter(user => {
        const matchesFilter = filter === "all" || user.role === filter
        const matchesSearch = searchTerm === "" || 
            user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.email.toLowerCase().includes(searchTerm.toLowerCase())
        return matchesFilter && matchesSearch
    })

    const getRoleBadge = (role: UserData["role"]) => {
        switch (role) {
            case "ADMIN":
                return <Badge className="bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-100"><Shield className="h-3 w-3 mr-1" />Admin</Badge>
            case "STAFF":
                return <Badge className="bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100">Staff</Badge>
            case "USER":
                return <Badge variant="outline" className="hover:bg-transparent">Usuario</Badge>
            default:
                return <Badge variant="outline" className="hover:bg-transparent">{role}</Badge>
        }
    }

    return (
        <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-blue-100">
                                <Users className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{usersData.totalUsers}</p>
                                <p className="text-xs text-gray-500">Total Usuarios</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-purple-100">
                                <Shield className="h-5 w-5 text-purple-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{usersData.admins}</p>
                                <p className="text-xs text-gray-500">Administradores</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-blue-100">
                                <UserCog className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{usersData.scanners}</p>
                                <p className="text-xs text-gray-500">Staff</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-green-100">
                                <CheckCircle className="h-5 w-5 text-green-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{usersData.verified}</p>
                                <p className="text-xs text-gray-500">Verificados</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Users Table */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <CardTitle>Listado de Usuarios</CardTitle>
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input
                                    placeholder="Buscar nombre o email..."
                                    className="pl-9 w-64"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <Button
                                variant={filter === "all" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setFilter("all")}
                            >
                                Todos
                            </Button>
                            <Button
                                variant={filter === "ADMIN" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setFilter("ADMIN")}
                            >
                                Admins
                            </Button>
                            <Button
                                variant={filter === "STAFF" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setFilter("STAFF")}
                            >
                                Staff
                            </Button>
                            <Button 
                                size="sm" 
                                className="gap-2 bg-green-600 hover:bg-green-700"
                                onClick={() => setShowAddStaffModal(true)}
                            >
                                <UserPlus className="h-4 w-4" />
                                Agregar Staff
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {filteredUsers.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <Users className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                            <p className="font-medium">No hay usuarios para mostrar</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b text-left text-sm text-gray-500">
                                        <th className="pb-3 font-medium">Usuario</th>
                                        <th className="pb-3 font-medium">Rol</th>
                                        <th className="pb-3 font-medium">Estado</th>
                                        <th className="pb-3 font-medium text-center">Compras</th>
                                        <th className="pb-3 font-medium text-center">Entradas</th>
                                        <th className="pb-3 font-medium">Registro</th>
                                        <th className="pb-3 font-medium text-center">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {filteredUsers.map((user) => (
                                        <tr key={user.id} className="text-sm hover:bg-gray-50">
                                            <td className="py-3">
                                                <div>
                                                    <p className="font-medium">{user.name}</p>
                                                    <p className="text-xs text-gray-500">{user.email}</p>
                                                </div>
                                            </td>
                                            <td className="py-3">
                                                {getRoleBadge(user.role)}
                                            </td>
                                            <td className="py-3">
                                                {user.emailVerifiedAt ? (
                                                    <Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100">
                                                        <CheckCircle className="h-3 w-3 mr-1" />
                                                        Verificado
                                                    </Badge>
                                                ) : (
                                                    <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 hover:bg-yellow-100">
                                                        <Clock className="h-3 w-3 mr-1" />
                                                        Pendiente
                                                    </Badge>
                                                )}
                                            </td>
                                            <td className="py-3 text-center">
                                                {user._count.orders}
                                            </td>
                                            <td className="py-3 text-center">
                                                {user._count.tickets}
                                            </td>
                                            <td className="py-3 text-gray-500">
                                                {new Date(user.createdAt).toLocaleDateString("es-PE", {
                                                    day: "2-digit",
                                                    month: "short",
                                                    year: "numeric"
                                                })}
                                            </td>
                                            <td className="py-3 text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => {
                                                            setSelectedUser(user)
                                                            setShowRoleModal(true)
                                                        }}
                                                        title="Cambiar rol"
                                                    >
                                                        <UserCog className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => {
                                                            setResetPasswordUser(user)
                                                            setNewTempPassword("")
                                                            setShowResetPasswordModal(true)
                                                        }}
                                                        title="Resetear contraseña"
                                                    >
                                                        <KeyRound className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Role Change Modal */}
            {showRoleModal && selectedUser && (
                <Modal onClose={() => { setShowRoleModal(false); setSelectedUser(null); }}>
                    <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold">Cambiar Rol de Usuario</h3>
                            <button 
                                onClick={() => {
                                    setShowRoleModal(false)
                                    setSelectedUser(null)
                                }}
                                className="p-1 hover:bg-gray-100 rounded"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        
                        <div className="mb-6">
                            <p className="text-sm text-gray-600 mb-1">Usuario:</p>
                            <p className="font-medium">{selectedUser.name}</p>
                            <p className="text-sm text-gray-500">{selectedUser.email}</p>
                        </div>

                        <div className="mb-6">
                            <p className="text-sm text-gray-600 mb-3">Seleccionar nuevo rol:</p>
                            <div className="space-y-2">
                                {[
                                    { role: "USER" as const, label: "Usuario", desc: "Puede comprar entradas" },
                                    { role: "STAFF" as const, label: "Staff", desc: "Puede escanear QR en eventos" },
                                    { role: "ADMIN" as const, label: "Administrador", desc: "Acceso total al panel" },
                                ].map(({ role, label, desc }) => (
                                    <button
                                        key={role}
                                        onClick={() => handleRoleChange(selectedUser.id, role)}
                                        disabled={updatingRole || selectedUser.role === role}
                                        className={`w-full p-3 rounded-lg border text-left transition-all ${
                                            selectedUser.role === role 
                                                ? "border-blue-500 bg-blue-50" 
                                                : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"
                                        } ${updatingRole ? "opacity-50" : ""}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="font-medium">{label}</p>
                                                <p className="text-xs text-gray-500">{desc}</p>
                                            </div>
                                            {selectedUser.role === role && (
                                                <Badge>Actual</Badge>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {updatingRole && (
                            <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Actualizando...
                            </div>
                        )}
                    </div>
                </Modal>
            )}

            {/* Add Staff Modal */}
            {showAddStaffModal && (
                <Modal onClose={() => { setShowAddStaffModal(false); setNewStaffEmail(""); setNewStaffName(""); }}>
                    <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold">Agregar Usuario Staff</h3>
                            <button 
                                onClick={() => {
                                    setShowAddStaffModal(false)
                                    setNewStaffEmail("")
                                    setNewStaffName("")
                                }}
                                className="p-1 hover:bg-gray-100 rounded"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        
                        <p className="text-sm text-gray-600 mb-4">
                            Crea un nuevo usuario con rol Staff para escanear QR en eventos. 
                            Se generará una contraseña temporal.
                        </p>

                        <form onSubmit={handleAddStaff} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Nombre completo</label>
                                <Input
                                    value={newStaffName}
                                    onChange={(e) => setNewStaffName(e.target.value)}
                                    placeholder="Juan Pérez"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Email</label>
                                <Input
                                    type="email"
                                    value={newStaffEmail}
                                    onChange={(e) => setNewStaffEmail(e.target.value)}
                                    placeholder="staff@fdnda.org"
                                    required
                                />
                            </div>
                            <Button 
                                type="submit" 
                                className="w-full gap-2"
                                disabled={addingStaff}
                            >
                                {addingStaff ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Creando...
                                    </>
                                ) : (
                                    <>
                                        <UserPlus className="h-4 w-4" />
                                        Crear Usuario Staff
                                    </>
                                )}
                            </Button>
                        </form>
                    </div>
                </Modal>
            )}

            {/* Reset Password Modal */}
            {showResetPasswordModal && resetPasswordUser && (
                <Modal onClose={() => { setShowResetPasswordModal(false); setResetPasswordUser(null); setNewTempPassword(""); }}>
                    <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold">Resetear Contraseña</h3>
                            <button 
                                onClick={() => {
                                    setShowResetPasswordModal(false)
                                    setResetPasswordUser(null)
                                    setNewTempPassword("")
                                }}
                                className="p-1 hover:bg-gray-100 rounded"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        
                        <div className="mb-4">
                            <p className="text-sm text-gray-600 mb-1">Usuario:</p>
                            <p className="font-medium">{resetPasswordUser.name}</p>
                            <p className="text-sm text-gray-500">{resetPasswordUser.email}</p>
                        </div>

                        {newTempPassword ? (
                            <div className="space-y-4">
                                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                                    <p className="text-sm text-green-700 mb-2 font-medium">
                                        Contraseña reseteada exitosamente
                                    </p>
                                    <p className="text-sm text-gray-600 mb-2">
                                        Nueva contraseña temporal:
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <code className="flex-1 px-3 py-2 bg-white border rounded font-mono text-lg">
                                            {newTempPassword}
                                        </code>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => copyToClipboard(newTempPassword)}
                                        >
                                            <Copy className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                <p className="text-xs text-gray-500">
                                    Comparte esta contraseña con el usuario. Deberá cambiarla después de iniciar sesión.
                                </p>
                                <Button 
                                    className="w-full"
                                    onClick={() => {
                                        setShowResetPasswordModal(false)
                                        setResetPasswordUser(null)
                                        setNewTempPassword("")
                                    }}
                                >
                                    Cerrar
                                </Button>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <p className="text-sm text-gray-600">
                                    Se generará una nueva contraseña temporal para este usuario. 
                                    La contraseña actual dejará de funcionar.
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        className="flex-1"
                                        onClick={() => {
                                            setShowResetPasswordModal(false)
                                            setResetPasswordUser(null)
                                        }}
                                    >
                                        Cancelar
                                    </Button>
                                    <Button
                                        className="flex-1 gap-2 bg-orange-600 hover:bg-orange-700"
                                        onClick={handleResetPassword}
                                        disabled={resettingPassword}
                                    >
                                        {resettingPassword ? (
                                            <>
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Reseteando...
                                            </>
                                        ) : (
                                            <>
                                                <KeyRound className="h-4 w-4" />
                                                Resetear
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </Modal>
            )}
        </div>
    )
}
