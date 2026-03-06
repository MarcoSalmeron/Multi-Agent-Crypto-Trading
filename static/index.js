document.getElementById("btnInvertir").addEventListener("click", function () {
    Swal.fire({
        title: '⚠️ Inicio de sesión requerido',
        html: `
        <p>Para poder realizar operaciones con criptomonedas en <strong>Criptol</strong>, 
        es necesario iniciar sesión con tu cuenta.</p>
        <p>Nuestro sistema de trading asistido por <em>IA con agentes inteligentes</em> 
        analiza criptomonedas y acciones, recomienda operaciones y aplica guardrails de riesgo 
        para proteger tu portafolio.</p>
        <p>Por favor, inicia sesión para acceder a todas las funcionalidades.</p>
      `,
        icon: 'warning',
        confirmButtonText: 'Iniciar sesión',
        confirmButtonColor: '#3085d6',
        showCancelButton: true,
        cancelButtonText: 'Cancelar',
        cancelButtonColor: '#aaa'
    }).then((result) => {
        if (result.isConfirmed) {
            // Redirige al login (ajusta la ruta según tu proyecto)
            window.location.href = loginUrl;
        }
    });
});